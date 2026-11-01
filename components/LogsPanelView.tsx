import { memo, type RefObject, type UIEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
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

interface LogEntryRowProps {
  entry: LogEntry;
  styles: LogsPanelStyles;
  expanded: boolean;
  onToggleEntry: (offset: number) => void;
}

/**
 * One log line. Memoized because the polling loop produces a new `entries`
 * array every couple of seconds while the existing entries keep their identity;
 * without this every visible row re-renders on each poll.
 */
const LogEntryRow = memo(function LogEntryRow({ entry, styles, expanded, onToggleEntry }: LogEntryRowProps) {
  return (
    <article
      className={styles.entry}
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
});

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
  catchingUp: boolean;
  selectedFile: string | null;
  expandedOffset: number | null;
  listRef?: RefObject<HTMLDivElement | null>;
  /** Reports list scrolling so the container can decide whether to keep pinning the bottom. */
  onListScroll?: (event: UIEvent<HTMLDivElement>) => void;
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
  catchingUp,
  selectedFile,
  expandedOffset,
  listRef,
  onListScroll,
  onLevelChange,
  onKeywordChange,
  onFileChange,
  onFollowChange,
  onTogglePause,
  onRefresh,
  onToggleEntry,
}: LogsPanelViewProps) {
  const { t } = useI18n();
  const state = describeLogsState({
    loading,
    error,
    fileCount: files.length,
    entryCount: entries.length,
    level,
    keyword,
    catchingUp,
  });
  const activeFile = selectedFile ?? file?.name ?? "";
  const stateText = state.kind === "ready"
    ? null
    : {
        title: t(`settings.logs.state.${state.kind}.title`),
        // error 的详情是服务端原文，不做翻译。
        detail: state.kind === "error" ? state.detail : t(`settings.logs.state.${state.kind}.detail`),
      };

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>{t("settings.logs.title")}</h2>
          <p className={styles.description}>{t("settings.logs.description")}</p>
        </div>
        <a
          className={styles.download}
          href={file ? downloadLogUrl(file.name) : undefined}
          download={file?.name}
          aria-disabled={!file}
        >
          {t("settings.logs.download")}
        </a>
      </header>

      <div className={styles.toolbar}>
        <label className={styles.field}>
          <span>{t("settings.logs.level")}</span>
          <select
            className={styles.select}
            value={level}
            aria-label={t("settings.logs.levelAria")}
            onChange={(event) => onLevelChange(event.target.value as LogLevelName | "all")}
          >
            {LOG_LEVEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{t(`settings.logs.level.${option.value}`)}</option>
            ))}
          </select>
        </label>
        <label className={`${styles.field} ${styles.searchField}`}>
          <span>{t("settings.logs.keyword")}</span>
          <input
            className={styles.input}
            value={keyword}
            placeholder={t("settings.logs.keywordPlaceholder")}
            aria-label={t("settings.logs.keywordAria")}
            onChange={(event) => onKeywordChange(event.target.value)}
          />
        </label>
        <label className={`${styles.field} ${styles.fileField}`}>
          <span>{t("settings.logs.file")}</span>
          <select
            className={styles.select}
            value={activeFile}
            aria-label={t("settings.logs.fileAria")}
            onChange={(event) => onFileChange(event.target.value || null)}
          >
            {files.length === 0 && <option value="">{t("settings.logs.noFileYet")}</option>}
            {files.map((item) => (
              <option key={item.name} value={item.name}>
                {formatFileLabel(item, { current: t("settings.logs.currentFile"), rotation: t("settings.logs.rotation") })} · {formatFileSize(item.size)}
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
            {follow ? t("settings.logs.following") : t("settings.logs.followLatest")}
          </button>
          <button
            type="button"
            className={styles.action}
            data-active={paused}
            aria-pressed={paused}
            onClick={onTogglePause}
          >
            {paused ? t("settings.logs.resume") : t("settings.logs.pause")}
          </button>
          <button type="button" className={styles.action} disabled={loading} onClick={onRefresh}>
            {loading ? t("settings.logs.refreshing") : t("settings.logs.refresh")}
          </button>
        </div>
      </div>

      <div className={styles.fileMeta}>
        {file ? (
          <>
            <code className={styles.fileName}>{file.name}</code>
            <span>{formatFileSize(file.size)}</span>
            <span>{t("settings.logs.lastWrite", { time: formatFileModified(file.modifiedAt) })}</span>
            {file.current && <span className={styles.currentBadge}>{t("settings.logs.active")}</span>}
          </>
        ) : (
          <span>{t("settings.logs.noFileSelected")}</span>
        )}
        {paused && <span className={styles.pausedBadge}>{t("settings.logs.pollingPaused")}</span>}
      </div>

      {error && entries.length > 0 && <div className={styles.errorBanner} role="alert">{error}</div>}

      <div className={styles.list} ref={listRef} data-state={state.kind} onScroll={onListScroll}>
        {stateText ? (
          <div
            className={styles.empty}
            role={state.kind === "error" ? "alert" : "status"}
            data-kind={state.kind}
          >
            <strong>{stateText.title}</strong>
            <span>{stateText.detail}</span>
          </div>
        ) : (
          entries.map((entry) => (
            <LogEntryRow
              key={entry.offset}
              entry={entry}
              styles={styles}
              expanded={expandedOffset === entry.offset}
              onToggleEntry={onToggleEntry}
            />
          ))
        )}
      </div>
    </div>
  );
}
