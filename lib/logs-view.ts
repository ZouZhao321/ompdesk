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

/** `omp.2026-10-24.1528.log.2` → `2026-10-24 · rotation 2`. */
export function formatFileLabel(file: LogFileInfo): string {
  const match = /^omp\.(\d{4}-\d{2}-\d{2})\.(\d+)\.log(?:\.(\d+))?$/.exec(file.name);
  if (!match) return file.name;
  return match[3] ? `${match[1]} · rotation ${match[3]}` : `${match[1]} · current file`;
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
}

/** Build the query string the panel polls with; cursor 0 is omitted so the route returns the head. */
export function buildLogsRequest(input: LogsRequestInput): string {
  const params = new URLSearchParams();
  if (input.file) params.set("file", input.file);
  if (input.cursor && input.cursor > 0) params.set("cursor", String(input.cursor));
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

export type LogsEmptyKind = "loading" | "error" | "no-files" | "empty" | "no-matches";

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
 * Enabling follow returns to the newest file; disabling it keeps whatever the
 * user selected. Following a rotated file would otherwise pin the panel to it.
 */
export function selectFileAfterFollow(follow: boolean, selectedFile: string | null): string | null {
  return follow ? null : selectedFile;
}
