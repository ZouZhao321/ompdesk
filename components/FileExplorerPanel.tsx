"use client";

import { useEffect, useRef, useState } from "react";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import { PanelIconButton } from "./PanelIconButton";
import { useI18n } from "@/hooks/useI18n";
import type { OpenFileOptions } from "@/lib/panel-tabs";

interface Props {
  cwd: string;
  onOpenFile: (filePath: string, fileName: string, options?: OpenFileOptions) => void;
  refreshKey: number;
  onRefresh: () => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
}

/**
 * Explorer view of the right panel tab page. The tab owns visibility, so the
 * panel itself only carries the tree toolbar and the tree.
 */
export function FileExplorerPanel({
  cwd,
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", flexShrink: 0, gap: 2, padding: "2px 6px 2px 4px" }}>
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
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
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
