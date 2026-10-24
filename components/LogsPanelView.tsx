import type { RefObject } from "react";
import type { LogEntry, LogFileInfo, LogLevelName } from "@/lib/api-types";
import {
  describeLogsState,
  downloadLogUrl,
  entryDetail,
  formatFileLabel,
  formatFileModified,
  formatFileSize,
  LOG_LEVEL_OPTIONS,
} from "@/lib/logs-view";

/**
 * Presentational half of the Logs panel. Kept free of CSS-module imports so
 * render tests can exercise every state without a bundler; `LogsPanel` supplies
 * the real class map.
 */

export type LogsPanelStyles = Record<string, string>;

export interface LogsPanelViewProps {
  styles: LogsPanelStyles;
  files: LogFileInfo[];
  file: LogFileInfo | null;
  entries: LogEntry[];
  level: LogLevelName | "all";
  keyword: string;
  follow: boolean;
  paused: boolean;
  loading: boolean;
  error: string | null;
  selectedFile: string | null;
  expandedOffset: number | null;
  listRef?: RefObject<HTMLDivElement | null>;
  onLevelChange: (level: LogLevelName | "all") => void;
  onKeywordChange: (keyword: string) => void;
  onFileChange: (name: string | null) => void;
  onFollowChange: (follow: boolean) => void;
  onTogglePause: () => void;
  onRefresh: () => void;
  onToggleEntry: (offset: number) => void;
}

export function LogsPanelView({
  styles,
  files,
  file,
  entries,
  level,
  keyword,
  follow,
  paused,
  loading,
  error,
  selectedFile,
  expandedOffset,
  listRef,
  onLevelChange,
  onKeywordChange,
  onFileChange,
  onFollowChange,
  onTogglePause,
  onRefresh,
  onToggleEntry,
}: LogsPanelViewProps) {
  const state = describeLogsState({
    loading,
    error,
    fileCount: files.length,
    entryCount: entries.length,
    level,
    keyword,
  });
  const activeFile = selectedFile ?? file?.name ?? "";

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Logs</h2>
          <p className={styles.description}>
            The current server process&apos;s log file, straight from omp&apos;s rotating log. Read-only; prompts,
            completions, tool arguments, file contents, and credentials are never written here.
          </p>
        </div>
        <a
          className={styles.download}
          href={file ? downloadLogUrl(file.name) : undefined}
          download={file?.name}
          aria-disabled={!file}
          onClick={(event) => { if (!file) event.preventDefault(); }}
        >
          Download
        </a>
      </header>

      <div className={styles.toolbar}>
        <label className={styles.field}>
          <span>Level</span>
          <select
            className={styles.select}
            value={level}
            aria-label="Log level"
            onChange={(event) => onLevelChange(event.target.value as LogLevelName | "all")}
          >
            {LOG_LEVEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className={`${styles.field} ${styles.searchField}`}>
          <span>Keyword</span>
          <input
            className={styles.input}
            value={keyword}
            placeholder="Filter by text"
            aria-label="Log keyword"
            onChange={(event) => onKeywordChange(event.target.value)}
          />
        </label>
        <label className={`${styles.field} ${styles.fileField}`}>
          <span>File</span>
          <select
            className={styles.select}
            value={activeFile}
            aria-label="Log file"
            onChange={(event) => onFileChange(event.target.value || null)}
          >
            {files.length === 0 && <option value="">No file yet</option>}
            {files.map((item) => (
              <option key={item.name} value={item.name}>
                {formatFileLabel(item)} · {formatFileSize(item.size)}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.action}
            data-active={follow}
            aria-pressed={follow}
            onClick={() => onFollowChange(!follow)}
          >
            {follow ? "Following" : "Follow latest"}
          </button>
          <button
            type="button"
            className={styles.action}
            data-active={paused}
            aria-pressed={paused}
            onClick={onTogglePause}
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button type="button" className={styles.action} disabled={loading} onClick={onRefresh}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className={styles.fileMeta}>
        {file ? (
          <>
            <code className={styles.fileName}>{file.name}</code>
            <span>{formatFileSize(file.size)}</span>
            <span>Last write {formatFileModified(file.modifiedAt)}</span>
            {file.current && <span className={styles.currentBadge}>active</span>}
          </>
        ) : (
          <span>No file selected</span>
        )}
        {paused && <span className={styles.pausedBadge}>Polling paused</span>}
      </div>

      {error && entries.length > 0 && <div className={styles.errorBanner} role="alert">{error}</div>}

      <div className={styles.list} ref={listRef} data-state={state.kind}>
        {state.kind !== "ready" ? (
          <div
            className={styles.empty}
            role={state.kind === "error" ? "alert" : "status"}
            data-kind={state.kind}
          >
            <strong>{state.title}</strong>
            <span>{state.detail}</span>
          </div>
        ) : (
          entries.map((entry) => {
            const expanded = expandedOffset === entry.offset;
            return (
              <article
                className={styles.entry}
                key={`${entry.offset}-${entry.raw.slice(0, 24)}`}
                data-level={entry.level ?? "raw"}
                data-expanded={expanded}
              >
                <button
                  type="button"
                  className={styles.entrySummary}
                  aria-expanded={expanded}
                  onClick={() => onToggleEntry(entry.offset)}
                >
                  <span className={styles.levelBadge} data-level={entry.level ?? "raw"}>
                    {entry.level ?? "raw"}
                  </span>
                  <span className={styles.entryMessage} title={entry.message}>{entry.message}</span>
                  <span className={styles.entryMeta}>
                    {entry.subsystem ?? entry.source}
                    <span aria-hidden="true"> · </span>
                    {entry.timestamp ?? `offset ${entry.offset}`}
                  </span>
                </button>
                {expanded && <pre className={styles.entryDetail}>{entryDetail(entry)}</pre>}
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
