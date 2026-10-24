import type { LogEntry, LogFileInfo, LogLevelName } from "./api-types";

/** Presentation state that can be reasoned about without React or timers. */

export interface LogLevelOption {
  value: LogLevelName | "all";
  label: string;
}

export const LOG_LEVEL_OPTIONS: LogLevelOption[] = [
  { value: "all", label: "All levels" },
  { value: "error", label: "Error and above" },
  { value: "warn", label: "Warn and above" },
  { value: "info", label: "Info and above" },
  { value: "debug", label: "Debug" },
];

export const MAX_VISIBLE_ENTRIES = 5_000;

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

/**
 * `omp.2026-10-24.1528.log.2` → `2026-10-24 15:28 · rotation 2`. The start time
 * keeps files from the same day distinguishable, and only the server's
 * `current` flag claims which file is active (a file from a previous process
 * has no rotation suffix either).
 */
export function formatFileLabel(file: LogFileInfo): string {
  const match = /^omp\.(\d{4}-\d{2}-\d{2})\.(\d+)\.log(?:\.(\d+))?$/.exec(file.name);
  if (!match) return file.name;
  const stamp = `${match[1]} ${match[2].slice(0, 2)}:${match[2].slice(2)}`;
  if (match[3]) return `${stamp} · rotation ${match[3]}`;
  return file.current ? `${stamp} · current file` : stamp;
}

export function formatFileModified(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function downloadLogUrl(fileName: string): string {
  return `/api/logs?download=1&file=${encodeURIComponent(fileName)}`;
}

export interface LogsRequestInput {
  file: string | null;
  cursor?: number;
  level?: LogLevelName | "all";
  keyword?: string;
  limit?: number;
  /** Start from the newest slice of the file; only meaningful when `cursor` is 0. */
  tail?: boolean;
  /** Identity from the previous page, echoed so a recreated same-name file resets. */
  fingerprint?: string | null;
}

/**
 * Build the query string the panel polls with. A cursor of 0 starts a fresh
 * read: `tail` asks for the newest slice instead of the file's head, and the
 * fingerprint is only meaningful alongside a real cursor.
 */
export function buildLogsRequest(input: LogsRequestInput): string {
  const params = new URLSearchParams();
  if (input.file) params.set("file", input.file);
  if (input.cursor && input.cursor > 0) {
    params.set("cursor", String(input.cursor));
    if (input.fingerprint) params.set("fingerprint", input.fingerprint);
  } else if (input.tail) {
    params.set("tail", "1");
  }
  if (input.level && input.level !== "all") params.set("level", input.level);
  const keyword = input.keyword?.trim();
  if (keyword) params.set("q", keyword);
  if (input.limit) params.set("limit", String(input.limit));
  const query = params.toString();
  return query ? `/api/logs?${query}` : "/api/logs";
}

/** Append a cursor page without duplicating lines already on screen. */
export function mergeLogEntries(existing: LogEntry[], incoming: LogEntry[], limit = MAX_VISIBLE_ENTRIES): LogEntry[] {
  if (incoming.length === 0) return existing.length > limit ? existing.slice(existing.length - limit) : existing;
  const lastExisting = existing[existing.length - 1];
  // The poll path almost always appends strictly newer offsets; skip the map
  // and sort unless a page overlaps or arrives out of order.
  if (!lastExisting || incoming[0].offset > lastExisting.offset) {
    const appended = existing.concat(incoming);
    return appended.length > limit ? appended.slice(appended.length - limit) : appended;
  }
  const byOffset = new Map<number, LogEntry>();
  for (const entry of existing) byOffset.set(entry.offset, entry);
  for (const entry of incoming) byOffset.set(entry.offset, entry);
  const merged = [...byOffset.values()].sort((left, right) => left.offset - right.offset);
  return merged.length > limit ? merged.slice(merged.length - limit) : merged;
}

export function entryDetail(entry: LogEntry): string {
  if (entry.parseError) {
    return `parseError: ${entry.parseError}\n\n${entry.raw}`;
  }
  return JSON.stringify(entry.fields, null, 2);
}

export type LogsEmptyKind = "loading" | "error" | "no-files" | "empty" | "no-matches" | "catching-up";

export interface LogsStateDescription {
  kind: LogsEmptyKind | "ready";
  title: string;
  detail: string;
}

export interface DescribeLogsStateInput {
  loading: boolean;
  error: string | null;
  fileCount: number;
  entryCount: number;
  level: LogLevelName | "all";
  keyword: string;
  /** The last page was cut short, so an empty list is provisional rather than final. */
  catchingUp?: boolean;
}

/** Distinguish "still loading", "load failed", "no file yet", "empty file", and "filters match nothing". */
export function describeLogsState(input: DescribeLogsStateInput): LogsStateDescription {
  if (input.error && input.entryCount === 0) {
    return { kind: "error", title: "Could not load logs", detail: input.error };
  }
  if (input.loading && input.entryCount === 0) {
    return { kind: "loading", title: "Loading logs…", detail: "Reading the current process log." };
  }
  if (input.fileCount === 0) {
    return {
      kind: "no-files",
      title: "No log file yet",
      detail: "ompdesk creates this process's log file with its first record. Send a message or retry a request, then refresh.",
    };
  }
  if (input.catchingUp && input.entryCount === 0) {
    return {
      kind: "catching-up",
      title: "Catching up…",
      detail: "The log file is longer than one page; reading the backlog before showing matches.",
    };
  }
  if (input.entryCount === 0 && (input.level !== "all" || input.keyword.trim())) {
    return { kind: "no-matches", title: "No matching entries", detail: "Try a broader level or another keyword." };
  }
  if (input.entryCount === 0) {
    return { kind: "empty", title: "This log file is empty", detail: "No entries have been written to it yet." };
  }
  return { kind: "ready", title: "", detail: "" };
}

/** Hidden tabs and paused panels never schedule a poll. */
export function shouldPollLogs(hidden: boolean, paused: boolean): boolean {
  return !hidden && !paused;
}

/**
 * Enabling follow returns to the newest file; disabling it keeps the user's
 * selection, or pins the file that was being followed. Following a rotated file
 * would otherwise pin the panel to it.
 */
export function selectFileAfterFollow(
  follow: boolean,
  selectedFile: string | null,
  currentFileName?: string | null,
): string | null {
  if (follow) return null;
  return selectedFile ?? currentFileName ?? null;
}
