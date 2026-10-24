import { closeSync, lstatSync, openSync, readFileSync, readSync, readdirSync, realpathSync, type Stats } from "node:fs";
import path from "node:path";
import { getLogsDir } from "@oh-my-pi/pi-utils/dirs";
import type { LogEntry, LogFileInfo, LogLevelName, LogsResponse } from "./api-types";

/**
 * Read-only access to the log files the current server process wrote.
 *
 * The SDK names files `omp.<local-day>.<pid>.log` and rotates to `.log.1`,
 * `.log.2`, …; only that exact set for `process.pid` is reachable here. Names
 * are validated against the pattern before any path join, so the panel can
 * never be used as a general file browser.
 */

export const DEFAULT_LOG_PAGE_LIMIT = 200;
export const MAX_LOG_PAGE_LIMIT = 1_000;
const MAX_LOG_PAGE_BYTES = 1_024 * 1_024;
const MAX_KEYWORD_LENGTH = 200;

const LOG_FILE_PATTERN = /^omp\.(\d{4}-\d{2}-\d{2})\.(\d+)\.log(?:\.(\d+))?$/;

const LEVEL_RANK: Record<string, number> = { error: 0, warn: 1, info: 2, debug: 3 };
const LEVEL_NAMES: Record<string, true> = { error: true, warn: true, info: true, debug: true };

export class LogQueryError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "LogQueryError";
    this.status = status;
  }
}

/**
 * Accept only a basename this process itself could have produced. Separators,
 * `..`, absolute paths, and another PID's files are all rejected here.
 */
export function validateLogFileName(name: unknown, pid: number = process.pid): string {
  if (typeof name !== "string" || name.length === 0 || name.length > 180) {
    throw new LogQueryError(400, "Invalid log file name");
  }
  if (name.includes("/") || name.includes("\\") || name.includes("\0") || name === "." || name === ".." || name !== path.basename(name)) {
    throw new LogQueryError(400, "Invalid log file name");
  }
  const match = LOG_FILE_PATTERN.exec(name);
  if (!match || match[2] !== String(pid)) {
    throw new LogQueryError(400, "Invalid log file name");
  }
  return name;
}

interface ResolvedLogFile {
  name: string;
  filePath: string;
  size: number;
  mtimeMs: number;
  modifiedAt: string;
}

function resolveLogFile(directory: string, name: string, pid: number): ResolvedLogFile {
  validateLogFileName(name, pid);
  const filePath = path.join(directory, name);
  if (path.dirname(path.resolve(filePath)) !== path.resolve(directory)) {
    throw new LogQueryError(400, "Invalid log file name");
  }

  let stat: Stats;
  try {
    stat = lstatSync(filePath);
  } catch {
    throw new LogQueryError(404, "Log file not found");
  }
  if (stat.isSymbolicLink()) throw new LogQueryError(400, "Log file must not be a symbolic link");
  if (!stat.isFile()) throw new LogQueryError(400, "Log path is not a regular file");

  try {
    const realDirectory = realpathSync(directory);
    const realFile = realpathSync(filePath);
    if (path.dirname(realFile) !== realDirectory || path.basename(realFile) !== name) {
      throw new LogQueryError(400, "Log file escapes the log directory");
    }
  } catch (error) {
    if (error instanceof LogQueryError) throw error;
    throw new LogQueryError(404, "Log file not found");
  }

  return {
    name,
    filePath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    modifiedAt: stat.mtime.toISOString(),
  };
}

/** List the current PID's log file and rotations, newest write first. */
export function listLogFiles(directory: string = getLogsDir(), pid: number = process.pid): LogFileInfo[] {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: ResolvedLogFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = LOG_FILE_PATTERN.exec(entry.name);
    if (!match || match[2] !== String(pid)) continue;
    try {
      const filePath = path.join(directory, entry.name);
      const stat = lstatSync(filePath);
      if (!stat.isFile()) continue;
      files.push({
        name: entry.name,
        filePath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        modifiedAt: stat.mtime.toISOString(),
      });
    } catch {
      // A rotation can disappear between readdir and stat; skip it.
    }
  }

  files.sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name));
  return files.map((file, index) => ({
    name: file.name,
    size: file.size,
    modifiedAt: file.modifiedAt,
    current: index === 0,
  }));
}

/** Parse one JSONL line into the panel's record shape, preserving unparseable text. */
export function parseLogEntry(raw: string, offset: number, length: number = Buffer.byteLength(raw)): LogEntry {
  const base = {
    offset,
    length,
    raw,
    level: null,
    timestamp: null,
    source: "sdk",
    subsystem: null,
    message: raw,
    fields: {} as Record<string, unknown>,
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ...base, parseError: error instanceof Error ? error.message : String(error) };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...base, parseError: "Expected a JSON object" };
  }

  const record = parsed as Record<string, unknown>;
  return {
    ...base,
    level: typeof record.level === "string" ? record.level : null,
    timestamp: typeof record.timestamp === "string" ? record.timestamp : null,
    source: typeof record.source === "string" && record.source ? record.source : "sdk",
    subsystem: typeof record.subsystem === "string" ? record.subsystem : null,
    message: typeof record.message === "string" ? record.message : raw,
    fields: record,
  };
}

function matchesLevel(entry: LogEntry, level: LogLevelName | "all"): boolean {
  if (level === "all") return true;
  const entryRank = entry.level === null ? undefined : LEVEL_RANK[entry.level.toLowerCase()];
  return entryRank !== undefined && entryRank <= LEVEL_RANK[level];
}

export interface ReadLogPageOptions {
  directory?: string;
  /** Basename from the file list; omitted selects the newest file. */
  file?: string | null;
  cursor?: number;
  limit?: number;
  level?: LogLevelName | "all";
  keyword?: string;
  pid?: number;
}

/**
 * Byte length of the complete lines in a page. `lastIndexOf` must be limited to
 * the bytes actually read: with a negative start offset it searches the whole
 * uninitialized allocation, and a stray newline there lasts past `bytesRead`.
 */
export function completeLinesEnd(buffer: Buffer, bytesRead: number, atEof: boolean): number {
  if (atEof) return bytesRead;
  const lastNewline = buffer.subarray(0, bytesRead).lastIndexOf(10);
  return lastNewline >= 0 ? lastNewline + 1 : bytesRead;
}

/** Read one raw-byte page, then apply level and keyword filters to the parsed lines. */
export function readLogPage(options: ReadLogPageOptions = {}): LogsResponse {
  const directory = options.directory ?? getLogsDir();
  const pid = options.pid ?? process.pid;
  const cursor = options.cursor ?? 0;
  const limit = options.limit ?? DEFAULT_LOG_PAGE_LIMIT;
  const level = options.level ?? "all";
  const keyword = options.keyword?.trim().toLowerCase() ?? "";

  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new LogQueryError(400, "Invalid cursor");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LOG_PAGE_LIMIT) {
    throw new LogQueryError(400, "Invalid limit");
  }
  if (level !== "all" && !LEVEL_NAMES[level]) throw new LogQueryError(400, "Invalid level");
  if (keyword.length > MAX_KEYWORD_LENGTH) throw new LogQueryError(400, "Keyword is too long");

  const files = listLogFiles(directory, pid);
  const name = options.file ?? files[0]?.name ?? null;
  if (!name) {
    return { pid, files, file: null, entries: [], nextCursor: 0, truncated: false, reset: false };
  }

  const resolved = resolveLogFile(directory, name, pid);
  const fileInfo: LogFileInfo = {
    name: resolved.name,
    size: resolved.size,
    modifiedAt: resolved.modifiedAt,
    current: files[0]?.name === resolved.name,
  };

  // A cursor beyond the current size means the writer restarted or rotated the
  // same basename; the old position no longer addresses any line.
  const reset = cursor > resolved.size;
  const start = reset ? 0 : cursor;
  const readLength = Math.min(resolved.size - start, MAX_LOG_PAGE_BYTES);
  if (readLength <= 0) {
    return { pid, files, file: fileInfo, entries: [], nextCursor: start, truncated: false, reset };
  }

  const buffer = Buffer.allocUnsafe(readLength);
  const fd = openSync(resolved.filePath, "r");
  let bytesRead = 0;
  try {
    while (bytesRead < readLength) {
      const chunk = readSync(fd, buffer, bytesRead, readLength - bytesRead, start + bytesRead);
      if (chunk <= 0) break;
      bytesRead += chunk;
    }
  } finally {
    closeSync(fd);
  }

  const atEof = start + bytesRead >= resolved.size;
  // Never consume a line the writer may still be appending unless the chunk
  // reaches EOF. A single record larger than the page is still surfaced.
  const end = completeLinesEnd(buffer, bytesRead, atEof);

  const entries: LogEntry[] = [];
  let position = 0;
  let consumed = start;
  while (position < end) {
    const newline = buffer.indexOf(10, position);
    const lineEnd = newline === -1 || newline >= end ? end : newline;
    const nextPosition = newline === -1 || newline >= end ? end : newline + 1;
    const segment = buffer.subarray(position, lineEnd);
    const offset = start + position;
    position = nextPosition;
    consumed = start + position;

    const raw = segment.toString("utf8").replace(/\r$/, "");
    if (!raw.trim()) continue;
    const entry = parseLogEntry(raw, offset, Buffer.byteLength(raw));
    if (!matchesLevel(entry, level)) continue;
    if (keyword && !raw.toLowerCase().includes(keyword)) continue;
    entries.push(entry);
    if (entries.length >= limit) break;
  }

  return {
    pid,
    files,
    file: fileInfo,
    entries,
    nextCursor: consumed,
    truncated: consumed < resolved.size,
    reset,
  };
}

export interface LogDownload {
  file: LogFileInfo;
  data: Buffer;
}

/** Read a validated log file verbatim for the download action. */
export function readLogDownload(file: unknown, options: { directory?: string; pid?: number } = {}): LogDownload {
  const directory = options.directory ?? getLogsDir();
  const pid = options.pid ?? process.pid;
  const name = validateLogFileName(file, pid);
  const resolved = resolveLogFile(directory, name, pid);
  return {
    file: {
      name: resolved.name,
      size: resolved.size,
      modifiedAt: resolved.modifiedAt,
      current: listLogFiles(directory, pid)[0]?.name === resolved.name,
    },
    data: readFileSync(resolved.filePath),
  };
}

export interface ParsedLogsQuery {
  file: string | null;
  cursor: number;
  limit: number;
  level: LogLevelName | "all";
  keyword: string;
  download: boolean;
}

function parseNonNegativeInteger(raw: string | null, field: string): number | undefined {
  if (raw === null || raw === "") return undefined;
  if (!/^\d+$/.test(raw)) throw new LogQueryError(400, `Invalid ${field}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new LogQueryError(400, `Invalid ${field}`);
  return value;
}

/** Turn `GET /api/logs` search params into validated reader options. */
export function parseLogsQuery(params: URLSearchParams): ParsedLogsQuery {
  const file = params.get("file");
  if (file !== null && file !== "") {
    // Shape first: traversal and arbitrary paths never reach the reader. The
    // current-PID check still runs there, so a syntactically valid name owned
    // by another process cannot be used.
    const match = LOG_FILE_PATTERN.exec(file);
    if (!match) throw new LogQueryError(400, "Invalid log file name");
    validateLogFileName(file, Number(match[2]));
  }

  const cursor = parseNonNegativeInteger(params.get("cursor"), "cursor") ?? 0;
  const limit = parseNonNegativeInteger(params.get("limit"), "limit") ?? DEFAULT_LOG_PAGE_LIMIT;
  if (limit < 1 || limit > MAX_LOG_PAGE_LIMIT) throw new LogQueryError(400, "Invalid limit");

  const requestedLevel = (params.get("level") ?? "all").toLowerCase();
  if (requestedLevel !== "all" && !LEVEL_NAMES[requestedLevel]) {
    throw new LogQueryError(400, "Invalid level");
  }

  const keyword = params.get("q") ?? "";
  if (keyword.length > MAX_KEYWORD_LENGTH) throw new LogQueryError(400, "Keyword is too long");

  const download = ["1", "true"].includes((params.get("download") ?? "").toLowerCase());

  return {
    file: file && file !== "" ? file : null,
    cursor,
    limit,
    level: requestedLevel as LogLevelName | "all",
    keyword,
    download,
  };
}
