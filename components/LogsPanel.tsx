"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LogEntry, LogFileInfo, LogLevelName, LogsResponse } from "@/lib/api-types";
import {
  buildLogsRequest,
  mergeLogEntries,
  selectFileAfterFollow,
  shouldPollLogs,
} from "@/lib/logs-view";
import { LogsPanelView } from "./LogsPanelView";
import styles from "./LogsPanel.module.css";

/**
 * Read-only log viewer for the current server process.
 *
 * Polling only advances a raw byte cursor, so new lines arrive without
 * re-reading the file; the panel never offers delete, clear, or a level
 * mutation. A hidden tab or the pause button stops the timer entirely.
 */

const POLL_INTERVAL_MS = 2_000;
const KEYWORD_DEBOUNCE_MS = 300;
/** Catch-up pages run back-to-back, but still yield to paint and input. */
const CATCH_UP_DELAY_MS = 50;
/** A hung read must not stall the poll chain or freeze the loading state. */
const REQUEST_TIMEOUT_MS = 15_000;

export interface LogsClientInput {
  file: string | null;
  cursor: number;
  level: LogLevelName | "all";
  keyword: string;
  /** Read the newest slice instead of the head; only used when `cursor` is 0. */
  tail?: boolean;
  /** Identity from the previous page, so a recreated file restarts. */
  fingerprint?: string | null;
  signal?: AbortSignal;
}

export type LogsClient = (input: LogsClientInput) => Promise<LogsResponse>;

const fetchLogsPage: LogsClient = async (input) => {
  const response = await fetch(
    buildLogsRequest({
      file: input.file,
      cursor: input.cursor,
      level: input.level,
      keyword: input.keyword,
      limit: 200,
      tail: input.tail,
      fingerprint: input.fingerprint,
    }),
    { cache: "no-store", signal: input.signal },
  );
  const data = await response.json() as LogsResponse & { error?: string };
  if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
};

export function LogsPanel({ client = fetchLogsPage }: { client?: LogsClient }) {
  const [files, setFiles] = useState<LogFileInfo[]>([]);
  const [file, setFile] = useState<LogFileInfo | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [level, setLevel] = useState<LogLevelName | "all">("all");
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedOffset, setExpandedOffset] = useState<number | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [catchingUp, setCatchingUp] = useState(false);

  const cursor = useRef(0);
  const activeFile = useRef<string | null>(null);
  const fingerprint = useRef<string | null>(null);
  const generation = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const update = () => setHidden(document.visibilityState === "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeyword(keyword.trim()), KEYWORD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    generation.current += 1;
    cursor.current = 0;
    activeFile.current = selectedFile;
    fingerprint.current = null;
    setEntries([]);
    setFile(null);
    setExpandedOffset(null);
    setError(null);
    setLoading(true);
    setCatchingUp(false);
  }, [selectedFile, level, debouncedKeyword, refreshToken]);

  const active = shouldPollLogs(hidden, paused);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const currentGeneration = generation.current;

    const tick = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), REQUEST_TIMEOUT_MS);
      let resetForFile = false;
      let pageTruncated = false;
      let advanced = false;
      try {
        const previousCursor = cursor.current;
        const page = await client({
          file: selectedFile,
          cursor: previousCursor,
          level,
          keyword: debouncedKeyword,
          tail: previousCursor === 0,
          fingerprint: fingerprint.current,
          signal: controller.signal,
        });
        if (cancelled || currentGeneration !== generation.current) return;

        // Following the newest file means the server can switch files under
        // us after rotation. A cursor from the previous file is meaningless
        // there, so discard that page and read the new file from its tail.
        const pageFile = page.file?.name ?? null;
        const fileChanged = pageFile !== activeFile.current;
        if (fileChanged) activeFile.current = pageFile;
        fingerprint.current = page.fingerprint ?? null;
        if (page.reset || (fileChanged && previousCursor > 0)) {
          // The writer restarted a shrunken or recreated file, or the followed
          // file changed: forget the cursor and read the new tail instead of
          // trusting a page positioned against the old file.
          cursor.current = 0;
          setEntries([]);
          resetForFile = true;
        } else {
          cursor.current = page.nextCursor;
          advanced = page.nextCursor > previousCursor;
          setEntries((previous) => mergeLogEntries(previous, page.entries));
          pageTruncated = page.truncated;
        }
        setCatchingUp(pageTruncated);
        setFiles(page.files);
        setFile(page.file);
        setError(null);
      } catch (caught) {
        if (cancelled || currentGeneration !== generation.current) return;
        setCatchingUp(false);
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        clearTimeout(timeout);
        if (!cancelled && currentGeneration === generation.current) {
          setLoading(false);
          // A truncated page leaves a backlog, but only continue while the
          // cursor actually moved: a stalled server must not spin at 0ms.
          timer = setTimeout(
            () => void tick(),
            resetForFile || (pageTruncated && advanced) ? CATCH_UP_DELAY_MS : POLL_INTERVAL_MS,
          );
        }
      }
    };

    void tick();
    return () => {
      cancelled = true;
      controller?.abort();
      clearTimeout(timer);
    };
  }, [active, client, debouncedKeyword, level, selectedFile, refreshToken]);

  const newestOffset = entries[entries.length - 1]?.offset ?? null;

  useEffect(() => {
    if (!follow || paused || newestOffset === null) return;
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
    // `entries.length` stops changing once the visible cap is reached; the
    // newest offset keeps advancing and still triggers the scroll.
  }, [newestOffset, follow, paused]);

  // Stable identity so memoized rows are not re-rendered by a new callback.
  const handleToggleEntry = useCallback((offset: number) => {
    setExpandedOffset((value) => value === offset ? null : offset);
  }, []);

  return (
    <LogsPanelView
      styles={styles}
      files={files}
      file={file}
      entries={entries}
      level={level}
      keyword={keyword}
      follow={follow}
      paused={paused}
      loading={loading}
      error={error}
      catchingUp={catchingUp}
      selectedFile={selectedFile}
      expandedOffset={expandedOffset}
      listRef={listRef}
      onLevelChange={(next) => { setPaused(false); setLevel(next); }}
      onKeywordChange={(value) => { setPaused(false); setKeyword(value); }}
      onFileChange={(next) => {
        // Picking a rotated file stops following: the "Following" contract is
        // `selectedFile === null`, and polling a pinned file while claiming to
        // follow would never show new lines.
        setPaused(false);
        setFollow(next === null);
        setSelectedFile(next);
      }}
      onFollowChange={(next) => {
        setFollow(next);
        setSelectedFile((current) => selectFileAfterFollow(next, current, file?.name));
      }}
      onTogglePause={() => setPaused((value) => !value)}
      onRefresh={() => { setPaused(false); setRefreshToken((value) => value + 1); }}
      onToggleEntry={handleToggleEntry}
    />
  );
}
