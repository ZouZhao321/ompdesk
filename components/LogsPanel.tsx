"use client";

import { useEffect, useRef, useState } from "react";
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

export interface LogsClientInput {
  file: string | null;
  cursor: number;
  level: LogLevelName | "all";
  keyword: string;
}

export type LogsClient = (input: LogsClientInput) => Promise<LogsResponse>;

const fetchLogsPage: LogsClient = async (input) => {
  const response = await fetch(
    buildLogsRequest({ ...input, limit: 200 }),
    { cache: "no-store" },
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
    const currentGeneration = generation.current;

    const tick = async () => {
      let resetForFile = false;
      let catchingUp = false;
      try {
        const page = await client({
          file: selectedFile,
          cursor: cursor.current,
          level,
          keyword: debouncedKeyword,
        });
        if (cancelled || currentGeneration !== generation.current) return;

        // Following the newest file means the server can switch files under
        // us after rotation. A cursor from the previous file is meaningless
        // there, so discard that page and read the new file from the head.
        const pageFile = page.file?.name ?? null;
        const fileChanged = pageFile !== activeFile.current;
        if (fileChanged) activeFile.current = pageFile;
        if (page.reset) {
          // The server already restarted at byte 0 for a shrunken file, so this
          // page is the new head and replaces what the panel shows.
          cursor.current = page.nextCursor;
          setEntries(page.entries);
        } else if (fileChanged && cursor.current > 0) {
          cursor.current = 0;
          setEntries([]);
          resetForFile = true;
        } else {
          cursor.current = page.nextCursor;
          setEntries((previous) => mergeLogEntries(previous, page.entries));
        }
        catchingUp = page.truncated;
        setCatchingUp(catchingUp);
        setFiles(page.files);
        setFile(page.file);
        setError(null);
      } catch (caught) {
        if (cancelled || currentGeneration !== generation.current) return;
        setCatchingUp(false);
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!cancelled && currentGeneration === generation.current) {
          setLoading(false);
          // A truncated page leaves a backlog: read the next page now instead
          // of waiting for the interval, so the panel does not linger on a
          // provisional empty/no-match view.
          timer = setTimeout(() => void tick(), resetForFile || catchingUp ? 0 : POLL_INTERVAL_MS);
        }
      }
    };

    void tick();
    return () => {
      cancelled = true;
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
      onFileChange={(next) => { setPaused(false); setSelectedFile(next); }}
      onFollowChange={(next) => {
        setFollow(next);
        setSelectedFile((current) => selectFileAfterFollow(next, current, file?.name));
      }}
      onTogglePause={() => setPaused((value) => !value)}
      onRefresh={() => { setPaused(false); setRefreshToken((value) => value + 1); }}
      onToggleEntry={(offset) => setExpandedOffset((value) => value === offset ? null : offset)}
    />
  );
}
