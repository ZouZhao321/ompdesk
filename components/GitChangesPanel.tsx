"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { getFileName, getRelativeFilePath } from "@/lib/file-paths";
import type { GitFileStatus, GitStatusResponse } from "@/lib/git-types";
import { MOBILE_HIT_TARGET_PX } from "@/lib/mobile-layout";
import { getFileIcon } from "./FileIcons";
import { GIT_STATUS_COLORS, GitStatusBadge } from "./GitStatusBadge";
import { PanelIconButton } from "./PanelIconButton";

/** 面板可见时轮询远端工作区状态的间隔。 */
const POLL_INTERVAL_MS = 5_000;

interface Props {
  cwd: string | null;
  onOpenFile: (
    filePath: string,
    fileName: string,
    options?: { sourceSessionId?: string | null; modeHint?: "diff" },
  ) => void;
  /** 面板是否可见；不可见时只停止轮询，保留已读取的状态。 */
  active?: boolean;
  /** 会话回合结束时递增，触发一次重新读取。 */
  refreshKey?: number;
}

function PanelMessage({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return (
    <div
      role={error ? "alert" : undefined}
      style={{
        padding: "10px 12px",
        fontSize: 11,
        lineHeight: 1.4,
        color: error ? "#f87171" : "var(--text-dim)",
        overflowWrap: "anywhere",
      }}
    >
      {children}
    </div>
  );
}

function ChangeRow({
  status,
  cwd,
  onOpenFile,
}: {
  status: GitFileStatus;
  cwd: string;
  onOpenFile: Props["onOpenFile"];
}) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [hovered, setHovered] = useState(false);
  const name = getFileName(status.filePath);
  const relativePath = getRelativeFilePath(status.filePath, cwd);

  return (
    <button
      type="button"
      onClick={() => onOpenFile(status.filePath, name, { modeHint: "diff" })}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={relativePath}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        width: "100%",
        height: isMobile ? MOBILE_HIT_TARGET_PX : 24,
        padding: "0 8px 0 10px",
        background: hovered ? "var(--bg-hover)" : "transparent",
        border: "none",
        borderRadius: 4,
        color: "inherit",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <GitStatusBadge status={status} t={t} />
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center", opacity: 0.85 }}>
        {getFileIcon(name, 13)}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12,
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {relativePath}
      </span>
    </button>
  );
}

/**
 * Git view of the right panel tab page：列出工作区里相对 HEAD 有变更的文件，
 * 点击行按 diff 打开文件标签。重新读取只发生在可见时。
 */
export function GitChangesPanel({ cwd, onOpenFile, active = true, refreshKey = 0 }: Props) {
  const { t } = useI18n();
  const [status, setStatus] = useState<GitStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshed, setRefreshed] = useState(false);
  const requestIdRef = useRef(0);
  const inFlightCwdRef = useRef<string | null>(null);
  const refreshedTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(refreshedTimerRef.current), []);

  const load = useCallback(
    async (silent: boolean) => {
      if (!cwd) {
        requestIdRef.current++;
        setStatus(null);
        setError(null);
        setLoading(false);
        return;
      }
      // 轮询与切换标签可能同时触发；同一目录只保留一次请求。
      if (inFlightCwdRef.current === cwd) return;
      inFlightCwdRef.current = cwd;
      const requestId = ++requestIdRef.current;
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams({ cwd });
        const response = await fetch(`/api/git/status?${params.toString()}`);
        if (!response.ok) throw new Error(t("git.loadFailed"));
        const next = (await response.json()) as GitStatusResponse;
        if (requestId !== requestIdRef.current) return;
        setStatus(next);
        setError(null);
      } catch (cause) {
        if (requestId !== requestIdRef.current) return;
        setError(cause instanceof Error ? cause.message : t("git.loadFailed"));
      } finally {
        if (inFlightCwdRef.current === cwd) inFlightCwdRef.current = null;
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [cwd, t],
  );

  // 项目目录或回合结束刷新键变化时重新读取。
  useEffect(() => {
    setStatus(null);
    setError(null);
    void load(false);
  }, [load, refreshKey]);

  // 可见时立即补拉一次，之后按间隔轮询；页面隐藏时跳过。
  useEffect(() => {
    if (!active || !cwd) return;
    void load(true);
    const pull = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const interval = window.setInterval(pull, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", pull);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", pull);
    };
  }, [active, cwd, load]);

  const handleRefresh = () => {
    void load(false);
    setRefreshed(true);
    window.clearTimeout(refreshedTimerRef.current);
    refreshedTimerRef.current = window.setTimeout(() => setRefreshed(false), 2_000);
  };

  const files = status?.isGitRepository ? status.files : [];
  const additions = status?.isGitRepository ? status.additions : 0;
  const deletions = status?.isGitRepository ? status.deletions : 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
          minHeight: 30,
          padding: "2px 6px 2px 10px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
            flex: 1,
            fontSize: 12,
            color: "var(--text-dim)",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {status?.isGitRepository && (
            <>
              <span>{t("git.changedCount", { count: files.length })}</span>
              {files.length > 0 && (
                <>
                  <span style={{ color: GIT_STATUS_COLORS.added, fontFamily: "var(--font-mono)" }}>+{additions}</span>
                  <span style={{ color: GIT_STATUS_COLORS.deleted, fontFamily: "var(--font-mono)" }}>-{deletions}</span>
                </>
              )}
            </>
          )}
        </div>
        <PanelIconButton
          onClick={handleRefresh}
          title={t("git.refresh")}
          skipHover={refreshed}
          color={refreshed ? "#4ade80" : "var(--text-dim)"}
          background={refreshed ? "rgba(74,222,128,0.18)" : "none"}
        >
          {refreshed ? (
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#4ade80"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          )}
        </PanelIconButton>
      </div>

      {error && <PanelMessage error>{error}</PanelMessage>}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "0 4px 8px",
        }}
      >
        {!cwd ? (
          <PanelMessage>{t("files.noProject")}</PanelMessage>
        ) : loading && !status ? (
          <PanelMessage>{t("git.loading")}</PanelMessage>
        ) : error && !status ? null : !status?.isGitRepository ? (
          <PanelMessage>{t("git.notRepository")}</PanelMessage>
        ) : files.length === 0 ? (
          <PanelMessage>{t("git.noChanges")}</PanelMessage>
        ) : (
          files.map((file) => <ChangeRow key={file.filePath} status={file} cwd={cwd} onOpenFile={onOpenFile} />)
        )}
      </div>
    </div>
  );
}
