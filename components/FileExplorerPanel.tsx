"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import { useI18n } from "@/hooks/useI18n";

interface Props {
  cwd: string;
  open: boolean;
  onToggleOpen: () => void;
  onOpenFile: (filePath: string, fileName: string, options?: { sourceSessionId?: string | null; modeHint?: "diff" }) => void;
  refreshKey: number;
  onRefresh: () => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
}

function PanelIconButton({
  onClick,
  title,
  disabled,
  skipHover,
  color,
  background = "none",
  marginRight,
  ariaPressed,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  skipHover?: boolean;
  color: string;
  background?: string;
  marginRight?: number;
  ariaPressed?: boolean;
  children: ReactNode;
}) {
  const enter = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || skipHover) return;
    e.currentTarget.style.color = "var(--text-muted)";
    e.currentTarget.style.background = "var(--bg-hover)";
  };
  const leave = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || skipHover) return;
    e.currentTarget.style.color = color;
    e.currentTarget.style.background = background;
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={ariaPressed}
      style={{
        position: "relative",
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 26, height: 26, padding: 0, marginRight,
        background,
        border: "none",
        color,
        cursor: disabled ? "default" : "pointer",
        borderRadius: 5,
        flexShrink: 0,
        opacity: disabled ? 0.6 : 1,
        transition: "color 0.3s, background 0.3s",
      }}
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      {children}
    </button>
  );
}

/**
 * File explorer inside the right file panel. Keeping it next to the viewer
 * means picking a file and reading it happen in the same surface, and the
 * sidebar stays dedicated to sessions.
 */
export function FileExplorerPanel({
  cwd,
  open,
  onToggleOpen,
  onOpenFile,
  refreshKey,
  onRefresh,
  onAtMention,
  onAtMentions,
}: Props) {
  const { t } = useI18n();
  const [uploadBusy, setUploadBusy] = useState(false);
  const [changesCount, setChangesCount] = useState(0);
  const [changesCollapsed, setChangesCollapsed] = useState(true);
  const [refreshDone, setRefreshDone] = useState(false);
  const refreshTimerRef = useRef<number | undefined>(undefined);
  const fileExplorerRef = useRef<FileExplorerHandle>(null);

  useEffect(() => {
    return () => {
      window.clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const handleRefresh = () => {
    onRefresh();
    setRefreshDone(true);
    window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => setRefreshDone(false), 2000);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0, paddingLeft: 4 }}>
        <button
          onClick={onToggleOpen}
          aria-expanded={open}
          title={open ? t("files.hideExplorer") : t("files.showExplorer")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: 1,
            minWidth: 0,
            padding: "6px 10px",
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            textAlign: "left",
          }}
        >
          <svg
            width="9" height="9" viewBox="0 0 10 10" fill="none"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}
            aria-hidden="true"
          >
            <polyline points="3 2 7 5 3 8" />
          </svg>
          {t("files.explorer")}
        </button>
        {changesCount > 0 && (
          <PanelIconButton
            onClick={() => setChangesCollapsed((v) => !v)}
            title={t("files.changedFiles", { count: changesCount })}
            ariaPressed={!changesCollapsed}
            color={changesCollapsed ? "var(--text-dim)" : "var(--accent)"}
            background={changesCollapsed ? "none" : "var(--bg-selected)"}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M3 12h6" />
              <path d="M15 12h6" />
            </svg>
          </PanelIconButton>
        )}
        <PanelIconButton
          onClick={() => fileExplorerRef.current?.openUploadPicker()}
          disabled={uploadBusy}
          title={t("files.uploadFilesTitle")}
          color="var(--text-dim)"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m17 8-5-5-5 5" />
            <path d="M12 3v12" />
          </svg>
        </PanelIconButton>
        <PanelIconButton
          onClick={handleRefresh}
          title={t("files.refreshExplorer")}
          skipHover={refreshDone}
          color={refreshDone ? "#4ade80" : "var(--text-dim)"}
          background={refreshDone ? "rgba(74,222,128,0.18)" : "none"}
          marginRight={6}
        >
          {refreshDone ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          )}
        </PanelIconButton>
      </div>
      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        overflowX: "hidden",
        display: open ? "block" : "none",
      }}>
        <FileExplorer
          ref={fileExplorerRef}
          cwd={cwd}
          onOpenFile={onOpenFile}
          refreshKey={refreshKey}
          onAtMention={onAtMention}
          onAtMentions={onAtMentions}
          onUploadBusyChange={setUploadBusy}
          changesCollapsed={changesCollapsed}
          onChangesCountChange={setChangesCount}
        />
      </div>
    </div>
  );
}
