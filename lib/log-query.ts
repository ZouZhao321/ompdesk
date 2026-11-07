import { createHash } from "node:crypto";
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
/**
 * First-screen window, measured back from EOF. Reading a multi-megabyte file
 * from byte 0 only to trim it back to the visible cap is wasted IO, so a
 * headless first page instead reads the newest slice.
 */
const MAX_LOG_TAIL_BYTES = 256 * 1_024;
/** Downloads are whole-file responses; larger files must be paged in the panel. */
export const MAX_LOG_DOWNLOAD_BYTES = 16 * 1_024 * 1_024;
const MAX_KEYWORD_LENGTH = 200;
const MAX_FINGERPRINT_LENGTH = 64;

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
  if (
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    name === "." ||
    name === ".." ||
    name !== path.basename(name)
  ) {
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
  /** Identity of the file object, stable across appends and different after a recreate. */
  fingerprint: string;
}

/**
 * `dev:ino:birthtime:head-hash` identifies the file object rather than its
 * contents: appends keep it, while a writer that deletes and recreates the
 * same basename gets a new one. The head hash covers filesystems that report
 * `ino` as 0 or a coarse birth time; a rotated file's first line differs,
 * whereas appending never touches it.
 */
function fileFingerprint(filePath: string, stat: Stats): string {
  const head = Buffer.alloc(256);
  let bytesRead = 0;
  const fd = openSync(filePath, "r");
  try {
    bytesRead = readSync(fd, head, 0, head.length, 0);
  } finally {
    closeSync(fd);
  }
  const hash = createHash("sha1")
    .update(head.subarray(0, Math.max(0, bytesRead)))
    .digest("hex")
    .slice(0, 12);
  return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}:${hash}`;
}

/**
 * A rotation can unlink the file between the listing, the stat, and the read.
 * That is a normal race for the panel, so it maps to a retryable 404 rather
 * than the route's generic 500.
 */
function isMissingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
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

  let fingerprint: string;
  try {
    fingerprint = fileFingerprint(filePath, stat);
  } catch (error) {
    if (isMissingFileError(error)) throw new LogQueryError(404, "Log file not found");
    throw error;
  }

  return {
    name,
    filePath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    modifiedAt: stat.mtime.toISOString(),
    fingerprint,
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

  const files: Array<Omit<ResolvedLogFile, "fingerprint">> = [];
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
  /** Read the newest slice of the file instead of the head; only used for `cursor: 0`. */
  tail?: boolean;
  /** Fingerprint from the previous page; a mismatch means the file was recreated. */
  fingerprint?: string | null;
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
    return {
      pid,
      files,
      file: null,
      entries: [],
      nextCursor: 0,
      truncated: false,
      reset: false,
      fingerprint: null,
    };
  }

  const resolved = resolveLogFile(directory, name, pid);
  const fileInfo: LogFileInfo = {
    name: resolved.name,
    size: resolved.size,
    modifiedAt: resolved.modifiedAt,
    current: files[0]?.name === resolved.name,
  };

  // A cursor beyond the current size means the writer restarted or rotated the
  // same basename. A cursor whose fingerprint no longer matches the file means
  // the same thing when the new file has already grown past the old position.
  const reset =
    cursor > resolved.size ||
    (cursor > 0 && typeof options.fingerprint === "string" && options.fingerprint !== resolved.fingerprint);
  const requestedStart = reset ? 0 : cursor;
  // Tail-first only applies to a fresh read; a cursor is always a line boundary.
  const useTail = !reset && cursor === 0 && options.tail === true && resolved.size > MAX_LOG_TAIL_BYTES;
  const start = useTail ? resolved.size - MAX_LOG_TAIL_BYTES : requestedStart;
  const readLength = Math.min(resolved.size - start, MAX_LOG_PAGE_BYTES);
  const fingerprint = resolved.fingerprint;
  if (readLength <= 0) {
    return {
      pid,
      files,
      file: fileInfo,
      entries: [],
      nextCursor: start,
      truncated: false,
      reset,
      fingerprint,
    };
  }

  const readWindow = (fromByte: number, length: number): Buffer => {
    const buffer = Buffer.allocUnsafe(length);
    let bytesRead = 0;
    let fd: number;
    try {
      fd = openSync(resolved.filePath, "r");
    } catch (error) {
      if (isMissingFileError(error)) throw new LogQueryError(404, "Log file not found");
      throw error;
    }
    try {
      while (bytesRead < length) {
        const chunk = readSync(fd, buffer, bytesRead, length - bytesRead, fromByte + bytesRead);
        if (chunk <= 0) break;
        bytesRead += chunk;
      }
    } catch (error) {
      if (isMissingFileError(error)) throw new LogQueryError(404, "Log file not found");
      throw error;
    } finally {
      closeSync(fd);
    }
    return buffer.subarray(0, bytesRead);
  };

  let tail = useTail;
  let windowStart = start;
  let buffer = readWindow(start, readLength);
  if (tail && buffer.indexOf(10) === -1) {
    // The tail window is one record with no newline in it: the file's last
    // record is larger than the window. Skipping it and moving the cursor to
    // EOF would hide it for good, because the cursor only moves forward, so
    // reread from the head where an oversized record is truncated but shown.
    tail = false;
    windowStart = 0;
    buffer = readWindow(0, Math.min(resolved.size, MAX_LOG_PAGE_BYTES));
  }

  const bytesRead = buffer.length;
  const atEof = windowStart + bytesRead >= resolved.size;
  // Never consume a line the writer may still be appending unless the chunk
  // reaches EOF. A single record larger than the page is still surfaced.
  const end = completeLinesEnd(buffer, bytesRead, atEof);

  const entries: LogEntry[] = [];
  let position = 0;
  if (tail) {
    // The window starts mid-line; skip that fragment so the first entry is a
    // whole record at a real line boundary.
    const firstNewline = buffer.indexOf(10);
    position = firstNewline === -1 || firstNewline >= end ? end : firstNewline + 1;
  }
  let consumed = windowStart + position;
  while (position < end) {
    const newline = buffer.indexOf(10, position);
    const lineEnd = newline === -1 || newline >= end ? end : newline;
    const nextPosition = newline === -1 || newline >= end ? end : newline + 1;
    const segment = buffer.subarray(position, lineEnd);
    const offset = windowStart + position;
    position = nextPosition;
    consumed = windowStart + position;

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
    // A page that consumed nothing (concurrent truncation, or no newline in
    // the window) is not a backlog: without progress a caller would re-request
    // the same offset forever.
    truncated: consumed > windowStart && consumed < resolved.size,
    reset,
    fingerprint,
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
  // The paged reader caps a response at MAX_LOG_PAGE_BYTES; an unbounded
  // synchronous whole-file read would block the event loop and can OOM.
  if (resolved.size > MAX_LOG_DOWNLOAD_BYTES) {
    throw new LogQueryError(413, "Log file is too large to download; use the paged viewer");
  }
  let data: Buffer;
  try {
    data = readFileSync(resolved.filePath);
  } catch (error) {
    // The file rotated away between resolution and the read.
    if (isMissingFileError(error)) throw new LogQueryError(404, "Log file not found");
    throw error;
  }
  return {
    file: {
      name: resolved.name,
      size: resolved.size,
      modifiedAt: resolved.modifiedAt,
      current: listLogFiles(directory, pid)[0]?.name === resolved.name,
    },
    data,
  };
}

export interface ParsedLogsQuery {
  file: string | null;
  cursor: number;
  limit: number;
  level: LogLevelName | "all";
  keyword: string;
  download: boolean;
  /** Read the newest slice when `cursor` is 0. */
  tail: boolean;
  /** Identity of the file the cursor came from, when the client sent one. */
  fingerprint: string | null;
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
  const tail = ["1", "true"].includes((params.get("tail") ?? "").toLowerCase());
  const fingerprint = params.get("fingerprint");
  if (fingerprint !== null && (fingerprint.length === 0 || fingerprint.length > MAX_FINGERPRINT_LENGTH)) {
    throw new LogQueryError(400, "Invalid fingerprint");
  }

  return {
    file: file && file !== "" ? file : null,
    cursor,
    limit,
    level: requestedLevel as LogLevelName | "all",
    keyword,
    download,
    tail,
    fingerprint,
  };
}
