"use client";

import { useEffect, useState, useRef, useCallback, useMemo, type MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import { useTheme } from "@/hooks/useTheme";
import { SourceView, SOURCE_CODE_STYLE, SOURCE_LINE_NUMBER_STYLE } from "./SourceCodeView";
import { DOCX_PREVIEW_MAX_BYTES, getFileExt, isAudioPath, isDocumentPreviewPath, isImagePath } from "@/lib/file-types";
import { getFileApiUrl, getFileDirectory, getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { resolveLocalFileHref } from "@/lib/file-links";
import { parseFrontmatter } from "@/lib/frontmatter";
import { markdownPreviewRehypePlugins, markdownPreviewRemarkPlugins, normalizeDisplayMath } from "@/lib/markdown";
import { CodeBlock, MermaidBlock } from "./MermaidBlock";
import { ImageZoomSurface } from "./ImageZoom";
import { MarkdownImage } from "./MarkdownImage";
import { FrontmatterCard } from "./FrontmatterCard";
import { parseUnifiedPatch } from "@/lib/patch";
import type { GitFileDiffResponse } from "@/lib/git-types";
import { useI18n } from "@/hooks/useI18n";
import { useCommentTranslationLookup, useCommentTranslationPreference } from "@/hooks/useCommentTranslation";
import { extractCommentEntries } from "@/lib/comment-entries";
import {
  commentTranslationKeys,
  commentTranslationRows,
  commentTranslationTarget,
} from "@/lib/comment-translation-render";
import { setCommentTranslationPreference } from "@/lib/comment-translation-preference";
import { setSourceWrapLines } from "@/lib/source-wrap-preference";
import { useSourceWrapLines } from "@/hooks/useSourceWrapLines";

interface Props {
  filePath: string;
  cwd?: string;
  sourceSessionId?: string | null;
  onOpenFile?: (filePath: string, sourceSessionId?: string | null) => void;
  onMentionLines?: (relativePath: string, startLine: number, endLine: number) => void;
  /** Insert this file's relative path into the chat input (@ mention). */
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  gitRefreshKey?: number;
  initialDisplayMode?: DisplayMode;
  /** 面板中只有当前标签保持文件监听与快捷键；隐藏标签传 false。 */
  active?: boolean;
}

interface FileData {
  content: string;
  language: string;
  size: number;
}

type DisplayMode = "source" | "preview" | "diff";

const DISPLAY_MODE_LABELS: Record<DisplayMode, string> = {
  source: "Source",
  preview: "Preview",
  diff: "Diff",
};

interface SelectedLineRange {
  startLine: number;
  endLine: number;
}

function MentionIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </svg>
  );
}

/** 相邻的源码行，跳过不占行号的译文行。 */
function adjacentSourceLine(element: HTMLElement, direction: "next" | "previous"): HTMLElement | null {
  let sibling = direction === "next" ? element.nextElementSibling : element.previousElementSibling;
  while (sibling) {
    if (sibling instanceof HTMLElement && sibling.matches(".file-source-line[data-line-number]")) return sibling;
    sibling = direction === "next" ? sibling.nextElementSibling : sibling.previousElementSibling;
  }
  return null;
}

function closestSourceLine(node: Node): HTMLElement | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!element) return null;

  const sourceLine = element.closest<HTMLElement>(".file-source-line[data-line-number]");
  if (sourceLine) return sourceLine;

  // 译文行属于它上方那条源码行：选区落进译文行时按该行取行号，
  // 引用到对话的行号与关闭译文时完全一致。
  const translation = element.closest<HTMLElement>(".file-comment-translation");
  return translation ? adjacentSourceLine(translation, "previous") : null;
}

function getSelectedSourceLineRange(root: HTMLElement, selection: Selection | null): SelectedLineRange | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  let startElement = closestSourceLine(range.startContainer);
  let endElement = closestSourceLine(range.endContainer);
  if (!startElement || !endElement || !root.contains(startElement) || !root.contains(endElement)) return null;

  let startLine = Number(startElement.dataset.lineNumber);
  let endLine = Number(endElement.dataset.lineNumber);
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return null;

  if (startLine < endLine) {
    // Browser ranges can start at the end of the preceding line or end at the
    // start of the following line. Exclude either boundary line when none of
    // its source text is actually selected.
    const startContent = startElement.querySelector<HTMLElement>(".file-source-line-content");
    if (startContent?.contains(range.startContainer)) {
      const selectedSuffix = document.createRange();
      selectedSuffix.selectNodeContents(startContent);
      selectedSuffix.setStart(range.startContainer, range.startOffset);
      if (selectedSuffix.toString().length === 0) {
        const nextLine = adjacentSourceLine(startElement, "next");
        if (nextLine) {
          startElement = nextLine;
          startLine = Number(startElement.dataset.lineNumber);
        }
      }
    }

    const endContent = endElement.querySelector<HTMLElement>(".file-source-line-content");
    if (endContent?.contains(range.endContainer)) {
      const selectedPrefix = document.createRange();
      selectedPrefix.selectNodeContents(endContent);
      selectedPrefix.setEnd(range.endContainer, range.endOffset);
      if (selectedPrefix.toString().length === 0) {
        const previousLine = adjacentSourceLine(endElement, "previous");
        if (previousLine) {
          endElement = previousLine;
          endLine = Number(endElement.dataset.lineNumber);
        }
      }
    }
  }

  if (startLine > endLine) return null;
  return { startLine, endLine };
}

type WatchPayload = { size?: number; mtime?: string };

function parseWatchPayload(event: MessageEvent): WatchPayload {
  try {
    return JSON.parse(event.data) as WatchPayload;
  } catch {
    return {};
  }
}

/**
 * 订阅单个文件的 watch 流：只有当前标签保持连接，重连时用 connected 带回的
 * mtime 判断隐藏期间是否有变化，变化才调用 onChanged。
 */
function useFileWatch({
  filePath,
  sourceSessionId,
  active,
  onChanged,
}: {
  filePath: string;
  sourceSessionId?: string | null;
  active: boolean;
  onChanged: (payload: WatchPayload) => void;
}): boolean {
  const [watching, setWatching] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const lastMtimeRef = useRef<string | null>(null);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  useEffect(() => {
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    if (!active) return;

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    const applyChange = (payload: WatchPayload) => {
      if (typeof payload.mtime === "string") lastMtimeRef.current = payload.mtime;
      onChangedRef.current(payload);
    };

    es.addEventListener("connected", (e) => {
      setWatching(true);
      const d = parseWatchPayload(e);
      if (typeof d.mtime !== "string") return;
      if (lastMtimeRef.current && lastMtimeRef.current !== d.mtime) {
        applyChange(d);
        return;
      }
      lastMtimeRef.current = d.mtime;
    });
    es.addEventListener("change", (e) => applyChange(parseWatchPayload(e)));
    es.addEventListener("error", () => setWatching(false));
    es.onerror = () => setWatching(false);

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [active, filePath, sourceSessionId]);

  return watching;
}

function DownloadLink({ filePath, sourceSessionId }: { filePath: string; sourceSessionId?: string | null }) {
  const { t } = useI18n();
  return (
    <a
      href={getFileApiUrl(filePath, "download", sourceSessionId)}
      download={getFileName(filePath)}
      title={t("i18n.downloadFile")}
      aria-label={t("i18n.downloadFile")}
      className="file-viewer-icon-button"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    </a>
  );
}

type DiffLine = {
  type: "unchanged" | "removed" | "added";
  text: string;
  oldLineNo: number | null;
  newLineNo: number | null;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function diffLines(patch: string): DiffLine[] {
  const files = parseUnifiedPatch(patch);
  if (!files) return [];

  return files.flatMap((file) =>
    file.rows.flatMap((row): DiffLine[] => {
      if (row.type === "hunk") return [];
      if (row.left.type === "context" && row.right.type === "context") {
        return [
          {
            type: "unchanged",
            text: row.right.text,
            oldLineNo: row.left.lineNo,
            newLineNo: row.right.lineNo,
          },
        ];
      }

      const lines: DiffLine[] = [];
      if (row.left.type === "removed") {
        lines.push({
          type: "removed",
          text: row.left.text,
          oldLineNo: row.left.lineNo,
          newLineNo: null,
        });
      }
      if (row.right.type === "added") {
        lines.push({
          type: "added",
          text: row.right.text,
          oldLineNo: null,
          newLineNo: row.right.lineNo,
        });
      }
      return lines;
    }),
  );
}

function DiffView({ patch }: { patch: string }) {
  const { t } = useI18n();
  const diff = diffLines(patch);

  const hasChanges = diff.some((l) => l.type !== "unchanged");
  if (!hasChanges) {
    return (
      <div
        style={{
          padding: "12px 16px",
          fontSize: 12,
          color: "var(--text-dim)",
          fontFamily: "var(--font-mono)",
        }}
      >
        {t("i18n.noChanges")}
      </div>
    );
  }

  // Render with context: show 3 lines around each change, collapse the rest
  const CONTEXT = 3;
  const changed = new Set(diff.flatMap((l, i) => (l.type !== "unchanged" ? [i] : [])));
  const visible = new Set<number>();
  for (const ci of changed) {
    for (let j = Math.max(0, ci - CONTEXT); j <= Math.min(diff.length - 1, ci + CONTEXT); j++) {
      visible.add(j);
    }
  }

  const segments: Array<{ hidden: true; count: number } | { hidden: false; lines: DiffLine[] }> = [];
  let i = 0;
  while (i < diff.length) {
    if (visible.has(i)) {
      const block: DiffLine[] = [];
      while (i < diff.length && visible.has(i)) {
        block.push(diff[i]);
        i++;
      }
      segments.push({ hidden: false, lines: block });
    } else {
      let count = 0;
      while (i < diff.length && !visible.has(i)) {
        count++;
        i++;
      }
      segments.push({ hidden: true, count });
    }
  }

  return (
    <div
      className="file-diff-view"
      style={{
        width: "max-content",
        minWidth: "100%",
        ...SOURCE_CODE_STYLE,
      }}
    >
      {segments.map((seg, si) => {
        if (seg.hidden) {
          const result = (
            <div
              key={si}
              style={{
                padding: "2px 16px",
                color: "var(--text-dim)",
                background: "var(--bg-panel)",
                fontSize: 11,
                borderTop: "1px solid var(--border)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              ... {seg.count} unchanged lines ...
            </div>
          );
          return result;
        }
        const lines = seg.lines.map((line, li) => {
          const bg =
            line.type === "added"
              ? "rgba(0,200,80,0.12)"
              : line.type === "removed"
                ? "rgba(240,60,60,0.14)"
                : "transparent";
          const prefix = line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
          const prefixColor =
            line.type === "added" ? "#4ade80" : line.type === "removed" ? "#f87171" : "var(--text-dim)";

          return (
            <div
              key={li}
              className="file-diff-line"
              style={{
                display: "flex",
                minWidth: "100%",
                background: bg,
                borderLeft:
                  line.type === "added"
                    ? "3px solid #4ade80"
                    : line.type === "removed"
                      ? "3px solid #f87171"
                      : "3px solid transparent",
              }}
            >
              <span style={SOURCE_LINE_NUMBER_STYLE}>{line.type === "removed" ? line.oldLineNo : line.newLineNo}</span>
              <span
                style={{
                  minWidth: 16,
                  padding: "0 6px",
                  color: prefixColor,
                  userSelect: "none",
                  flexShrink: 0,
                  fontWeight: 600,
                }}
              >
                {prefix}
              </span>
              <span
                className="file-diff-line-content"
                style={{
                  flexShrink: 0,
                  padding: "0 8px 0 0",
                  whiteSpace: "pre",
                  color: "var(--text)",
                }}
              >
                {line.text || "\u00a0"}
              </span>
            </div>
          );
        });
        return <div key={si}>{lines}</div>;
      })}
    </div>
  );
}

function ImageViewer({ filePath, cwd, sourceSessionId, active = true }: Props) {
  const { t } = useI18n();
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ src: string; w: number; h: number } | null>(null);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setNaturalSize(null);
  }, [filePath, sourceSessionId]);

  const watching = useFileWatch({
    filePath,
    sourceSessionId,
    active,
    onChanged: (d) => {
      if (typeof d.size === "number") setSize(d.size);
      setNaturalSize(null);
      setBust((b) => b + 1);
    },
  });

  const src = getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined);

  const formatSizeStr = size != null ? formatSize(size) : null;
  const naturalSizeOfCurrentFile = naturalSize?.src === src ? naturalSize : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext || "image"}</span>
        {naturalSizeOfCurrentFile && (
          <span>
            {naturalSizeOfCurrentFile.w} × {naturalSizeOfCurrentFile.h}
          </span>
        )}
        {formatSizeStr && <span>{formatSizeStr}</span>}
        <span
          title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            color: watching ? "#4ade80" : "var(--text-dim)",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "#4ade80" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
      </div>
      <ImageZoomSurface
        key={`${sourceSessionId ?? ""}:${filePath}`}
        src={src}
        alt={filePath}
        onNaturalSize={(size) => setNaturalSize({ src, ...size })}
      />
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  const totalSeconds = Math.round(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function AudioViewer({ filePath, cwd, sourceSessionId, active = true }: Props) {
  const { t } = useI18n();
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setDuration(null);
    setError(null);
  }, [filePath, sourceSessionId]);

  const watching = useFileWatch({
    filePath,
    sourceSessionId,
    active,
    onChanged: (d) => {
      if (typeof d.size === "number") setSize(d.size);
      setDuration(null);
      setError(null);
      setBust((b) => b + 1);
    },
  });

  const src = getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext || "audio"}</span>
        {duration != null && <span>{formatDuration(duration)}</span>}
        {size != null && <span>{formatSize(size)}</span>}
        <span
          title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            color: watching ? "#4ade80" : "var(--text-dim)",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "#4ade80" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "var(--bg-panel)",
        }}
      >
        <div style={{ width: "min(680px, 100%)" }}>
          {error && (
            <div style={{ color: "#f87171", fontSize: 13, marginBottom: 12, textAlign: "center" }}>{error}</div>
          )}
          <audio
            key={src}
            controls
            preload="metadata"
            src={src}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onError={() => setError("Failed to load audio")}
            style={{ width: "100%" }}
          />
        </div>
      </div>
    </div>
  );
}

function DocumentViewer({ filePath, cwd, sourceSessionId, active = true }: Props) {
  const { t } = useI18n();
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ext = getFileExt(filePath);
  const isPdf = ext === "pdf";
  const previewUrl = isPdf
    ? getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined)
    : getFileApiUrl(filePath, "preview", sourceSessionId, bust ? { v: bust } : undefined);

  useEffect(() => {
    setBust(0);
    setSize(null);
    setError(null);

    fetch(getFileApiUrl(filePath, "meta", sourceSessionId))
      .then((r) => r.json())
      .then((d: { size?: number; error?: string }) => {
        if (d.error) setError(d.error);
        if (typeof d.size === "number") {
          setSize(d.size);
          if (!isPdf && d.size > DOCX_PREVIEW_MAX_BYTES) {
            setError("DOCX too large for preview (>10MB)");
          }
        }
      })
      .catch((e) => setError(String(e)));
  }, [filePath, isPdf, sourceSessionId]);

  const watching = useFileWatch({
    filePath,
    sourceSessionId,
    active,
    onChanged: (d) => {
      if (typeof d.size === "number") {
        setSize(d.size);
        if (!isPdf && d.size > DOCX_PREVIEW_MAX_BYTES) {
          setError("DOCX too large for preview (>10MB)");
          return;
        }
      }
      setError(null);
      setBust((b) => b + 1);
    },
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={filePath}
        >
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext === "docx" ? "docx preview" : "pdf"}</span>
        {size != null && <span>{formatSize(size)}</span>}
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
        <span
          title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            color: watching ? "#4ade80" : "var(--text-dim)",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "#4ade80" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, background: "var(--bg-panel)" }}>
        {error ? (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              color: "#f87171",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            {error}
          </div>
        ) : (
          <iframe
            key={previewUrl}
            src={previewUrl}
            sandbox={isPdf ? undefined : "allow-same-origin"}
            title={t("i18n.previewFile", { file: getFileName(filePath) })}
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              background: isPdf ? "var(--bg)" : "#eef1f5",
            }}
          />
        )}
      </div>
    </div>
  );
}

export function FileViewer({
  filePath,
  cwd,
  sourceSessionId,
  onOpenFile,
  onMentionLines,
  onAtMention,
  gitRefreshKey,
  initialDisplayMode,
  active = true,
}: Props) {
  if (isImagePath(filePath)) {
    return <ImageViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} active={active} />;
  }
  if (isAudioPath(filePath)) {
    return <AudioViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} active={active} />;
  }
  if (isDocumentPreviewPath(filePath)) {
    return <DocumentViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} active={active} />;
  }
  return (
    <TextFileViewer
      filePath={filePath}
      cwd={cwd}
      sourceSessionId={sourceSessionId}
      onOpenFile={onOpenFile}
      onMentionLines={onMentionLines}
      onAtMention={onAtMention}
      gitRefreshKey={gitRefreshKey}
      initialDisplayMode={initialDisplayMode}
      active={active}
    />
  );
}

function TextFileViewer({
  filePath,
  cwd,
  sourceSessionId,
  onOpenFile,
  onMentionLines,
  onAtMention,
  gitRefreshKey,
  initialDisplayMode,
  active = true,
}: Props) {
  const { isDark } = useTheme();
  const { t, locale } = useI18n();
  const [data, setData] = useState<FileData | null>(null);
  const [gitDiff, setGitDiff] = useState<GitFileDiffResponse | null>(null);
  const [gitDiffLoading, setGitDiffLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("source");
  const wrapLines = useSourceWrapLines();
  const gitDiffRequestRef = useRef(0);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [selectedLineRange, setSelectedLineRange] = useState<SelectedLineRange | null>(null);

  const fetchContent = useCallback(
    (filePath: string) => {
      return fetch(getFileApiUrl(filePath, "read", sourceSessionId))
        .then((r) => r.json())
        .then((d: FileData & { error?: string }) => {
          if (d.error) {
            setError(d.error);
            return null;
          }
          setError(null);
          setData(d);
          return d;
        })
        .catch((e) => {
          setError(String(e));
          return null;
        });
    },
    [sourceSessionId],
  );

  const fetchGitDiff = useCallback(
    async (targetPath: string) => {
      const requestId = ++gitDiffRequestRef.current;
      setGitDiffLoading(true);
      if (!cwd) {
        setGitDiff(null);
        setGitDiffLoading(false);
        return;
      }

      try {
        const params = new URLSearchParams({ cwd, path: targetPath });
        const response = await fetch(`/api/git/diff?${params.toString()}`);
        const next = (await response.json()) as GitFileDiffResponse & { error?: string };
        if (requestId !== gitDiffRequestRef.current) return;
        setGitDiff(response.ok && next.supported && typeof next.patch === "string" ? next : null);
      } catch {
        if (requestId === gitDiffRequestRef.current) setGitDiff(null);
      } finally {
        if (requestId === gitDiffRequestRef.current) setGitDiffLoading(false);
      }
    },
    [cwd],
  );

  // Initial load
  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    setGitDiff(null);
    setDisplayMode("source");

    fetchContent(filePath).finally(() => setLoading(false));
  }, [filePath, fetchContent]);

  // 只有当前标签刷新 git diff
  useEffect(() => {
    if (!active) return;
    void fetchGitDiff(filePath);
  }, [active, fetchGitDiff, filePath, gitRefreshKey]);

  useEffect(() => {
    // HTML gets the same rendered-first treatment as markdown: a generated page
    // is usually more useful viewed than read as source. Both have a preview
    // mode already; the source tab stays one click away.
    if ((data?.language === "markdown" || data?.language === "html") && initialDisplayMode !== "diff") {
      setDisplayMode("preview");
    }
  }, [data?.language, initialDisplayMode]);

  const hasGitDiff = gitDiff?.supported === true && typeof gitDiff.patch === "string";
  const isDeletedDiff = hasGitDiff && gitDiff.status === "deleted";

  // 切换标签、关闭面板或文件已被删除时都不保持监听。
  const watching = useFileWatch({
    filePath,
    sourceSessionId,
    active: active && !isDeletedDiff,
    onChanged: () => {
      void fetchContent(filePath);
      void fetchGitDiff(filePath);
    },
  });

  useEffect(() => {
    if (!hasGitDiff && displayMode === "diff") setDisplayMode("source");
  }, [displayMode, hasGitDiff]);

  // Opened from the Changes list (initialDisplayMode === "diff"): switch to the
  // diff view once the git diff has resolved. We do this after the diff loads
  // rather than at mount so files without a diff never flash an empty diff view.
  const autoDiffAppliedRef = useRef(false);
  useEffect(() => {
    autoDiffAppliedRef.current = false;
  }, [filePath]);
  useEffect(() => {
    if (initialDisplayMode === "diff" && hasGitDiff && !autoDiffAppliedRef.current) {
      autoDiffAppliedRef.current = true;
      setDisplayMode("diff");
    }
  }, [initialDisplayMode, hasGitDiff]);

  const markdownPreview = useMemo(
    () => (data?.language === "markdown" ? normalizeDisplayMath(data.content) : ""),
    [data],
  );

  const frontmatter = useMemo(() => (data?.language === "markdown" ? parseFrontmatter(data.content) : null), [data]);

  // 注释译文只对 .ts/.tsx 生效；开关默认关闭，关闭时不产生任何译文行。
  const supportsCommentTranslation = /\.(ts|tsx)$/i.test(filePath);
  const commentTranslationEnabled = useCommentTranslationPreference();
  const translationTarget = commentTranslationTarget(locale);
  const showCommentTranslations =
    supportsCommentTranslation && commentTranslationEnabled && displayMode === "source" && !isDeletedDiff;

  const commentEntries = useMemo(
    () =>
      supportsCommentTranslation && data
        ? extractCommentEntries([{ path: filePath, content: data.content }]).entries
        : [],
    [data, filePath, supportsCommentTranslation],
  );

  const translationKeys = useMemo(
    () => (showCommentTranslations ? commentTranslationKeys(commentEntries, translationTarget) : []),
    [commentEntries, showCommentTranslations, translationTarget],
  );

  const commentTranslations = useCommentTranslationLookup(translationKeys, active && showCommentTranslations);

  // 译文行按源码行号索引；字典或开关变化都会让这个映射重建，查看器随之更新。
  const translationRows = useMemo(
    () =>
      commentTranslationRows({
        entries: commentEntries,
        translations: commentTranslations,
        targetLanguage: translationTarget,
        enabled: showCommentTranslations,
      }),
    [commentEntries, commentTranslations, showCommentTranslations, translationTarget],
  );

  useEffect(() => {
    if (!active || !onMentionLines || displayMode !== "source") {
      setSelectedLineRange(null);
      return;
    }
    const updateSelectedLineRange = () => {
      const root = contentRef.current;
      setSelectedLineRange(
        displayMode === "source" && root ? getSelectedSourceLineRange(root, window.getSelection()) : null,
      );
    };

    updateSelectedLineRange();

    document.addEventListener("selectionchange", updateSelectedLineRange);
    return () => document.removeEventListener("selectionchange", updateSelectedLineRange);
  }, [active, data?.content, displayMode, onMentionLines]);

  const mentionLineRange = useCallback(
    (lineRange: SelectedLineRange | null) => {
      if (!onMentionLines || !lineRange) return;
      onMentionLines(getRelativeFilePath(filePath, cwd), lineRange.startLine, lineRange.endLine);
    },
    [cwd, filePath, onMentionLines],
  );

  useEffect(() => {
    if (!active || !onMentionLines || displayMode !== "source") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.key.toLowerCase() !== "i" ||
        (!event.metaKey && !event.ctrlKey) ||
        event.altKey ||
        event.shiftKey
      )
        return;

      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, [contenteditable='true']")) return;

      const root = contentRef.current;
      const lineRange = root ? getSelectedSourceLineRange(root, window.getSelection()) : null;
      if (!lineRange) return;

      event.preventDefault();
      mentionLineRange(lineRange);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, displayMode, mentionLineRange, onMentionLines]);

  if (loading || (initialDisplayMode === "diff" && gitDiffLoading && !data)) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted)",
          fontSize: 13,
        }}
      >
        {t("i18n.loading")}
      </div>
    );
  }

  if (error && !isDeletedDiff) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#f87171",
          fontSize: 13,
        }}
      >
        {error}
      </div>
    );
  }

  if (!data && !isDeletedDiff) return null;

  const language = data?.language ?? "text";
  const content = data?.content ?? "";
  const isHtml = language === "html";
  const isMarkdown = language === "markdown";
  const hasPreview = isHtml || isMarkdown;
  const markdownDirectory = getFileDirectory(filePath);
  const lines = content.split("\n");
  const effectiveDisplayMode = isDeletedDiff ? "diff" : displayMode;
  const displayModes: DisplayMode[] = isDeletedDiff
    ? ["diff"]
    : ["source", ...(hasPreview ? ["preview" as const] : []), ...(hasGitDiff ? ["diff" as const] : [])];
  const metadata = isDeletedDiff
    ? t("files.deleted")
    : `${language} · ${lines.length} lines · ${formatSize(data!.size)}`;

  return (
    <div
      className="file-viewer-shell"
      style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}
    >
      <div
        className="file-viewer-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 12px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span className="file-viewer-path" style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>

        <span className="file-viewer-meta" title={metadata}>
          {metadata}
        </span>
        {!isDeletedDiff && (
          <span
            title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
            aria-label={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
            className="file-viewer-live-indicator"
            style={{
              background: watching ? "#4ade80" : "var(--border)",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
            }}
          />
        )}

        <div className="file-viewer-controls">
          {displayModes.length > 1 && (
            <div className="file-viewer-mode-switch" aria-label={t("i18n.fileViewMode")}>
              {displayModes.map((mode) => {
                const active = effectiveDisplayMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setDisplayMode(mode)}
                    title={mode === "diff" ? t("i18n.compareHead") : undefined}
                    aria-pressed={active}
                    className="file-viewer-mode-button"
                    style={{
                      background: active ? "var(--bg-selected)" : "transparent",
                      color: active ? "var(--text)" : "var(--text-muted)",
                    }}
                  >
                    {DISPLAY_MODE_LABELS[mode]}
                  </button>
                );
              })}
            </div>
          )}

          <div className="file-viewer-actions">
            {(onAtMention || onMentionLines) && (
              <button
                type="button"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  // Mention selected lines when a range is active (and line
                  // mention is wired up); otherwise fall back to a whole-file
                  // @mention. Same button, behavior follows the selection.
                  if (selectedLineRange && onMentionLines) {
                    mentionLineRange(selectedLineRange);
                  } else {
                    onAtMention?.(getRelativeFilePath(filePath, cwd), false);
                  }
                }}
                title={
                  selectedLineRange && onMentionLines
                    ? `${t("i18n.mentionSelectedLines")} (L${selectedLineRange.startLine}${selectedLineRange.startLine !== selectedLineRange.endLine ? `-L${selectedLineRange.endLine}` : ""})`
                    : t("files.insertPath")
                }
                aria-label={t("files.mention")}
                disabled={!onAtMention && !onMentionLines}
                className="file-viewer-icon-button"
              >
                <MentionIcon />
              </button>
            )}
            {effectiveDisplayMode === "source" && (
              <>
                <button
                  type="button"
                  onClick={() => setSourceWrapLines(!wrapLines)}
                  title={wrapLines ? t("i18n.disableWrap") : t("i18n.enableWrap")}
                  aria-label={wrapLines ? t("i18n.disableWrap") : t("i18n.enableWrap")}
                  aria-pressed={wrapLines}
                  className="file-viewer-icon-button"
                  style={{
                    background: wrapLines ? "var(--bg-selected)" : "transparent",
                    color: wrapLines ? "var(--text)" : "var(--text-muted)",
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 6h18" />
                    <path d="M3 12h15a3 3 0 1 1 0 6h-4" />
                    <path d="m16 16-2 2 2 2" />
                    <path d="M3 18h7" />
                  </svg>
                </button>
                {supportsCommentTranslation && (
                  <button
                    type="button"
                    onClick={() => setCommentTranslationPreference(!commentTranslationEnabled)}
                    title={
                      commentTranslationEnabled ? t("i18n.hideCommentTranslations") : t("i18n.showCommentTranslations")
                    }
                    aria-label={
                      commentTranslationEnabled ? t("i18n.hideCommentTranslations") : t("i18n.showCommentTranslations")
                    }
                    aria-pressed={commentTranslationEnabled}
                    className="file-viewer-icon-button"
                    style={{
                      background: commentTranslationEnabled ? "var(--bg-selected)" : "transparent",
                      color: commentTranslationEnabled ? "var(--text)" : "var(--text-muted)",
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" />
                    </svg>
                  </button>
                )}
              </>
            )}
          </div>

          {!isDeletedDiff && <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />}
        </div>
      </div>

      {/* Content area */}
      <div
        ref={contentRef}
        className="file-viewer-content"
        style={{ flex: 1, overflow: "auto", background: "var(--bg)" }}
      >
        {effectiveDisplayMode === "diff" && hasGitDiff ? (
          <DiffView patch={gitDiff.patch!} />
        ) : isHtml && effectiveDisplayMode === "preview" ? (
          <iframe
            srcDoc={content}
            sandbox="allow-scripts"
            style={{ width: "100%", height: "100%", border: "none", background: "var(--bg)" }}
            title={t("i18n.htmlPreview")}
          />
        ) : isMarkdown && effectiveDisplayMode === "preview" ? (
          <div className="markdown-body markdown-file-preview" style={{ padding: "24px 32px" }}>
            {frontmatter?.data && <FrontmatterCard data={frontmatter.data} />}
            <ReactMarkdown
              remarkPlugins={markdownPreviewRemarkPlugins}
              rehypePlugins={markdownPreviewRehypePlugins}
              components={{
                code({ className, children, ...props }) {
                  const lang = className?.replace("language-", "").toLowerCase() ?? "";
                  const raw = String(children);
                  const isBlock = className?.includes("language-") || raw.includes("\n");
                  if (isBlock) {
                    if (lang === "mermaid") {
                      return <MermaidBlock code={raw.replace(/\n$/, "")} defaultPreview />;
                    }
                    return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
                  }
                  return (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                },
                pre({ children }) {
                  // Render the code block directly — CodeBlock provides its own wrapping.
                  // For non-mermaid blocks, pass through to default pre rendering.
                  return <>{children}</>;
                },
                a({ href, children, ...props }) {
                  delete props.node;
                  const linkedFile = onOpenFile
                    ? resolveLocalFileHref(href, markdownDirectory, cwd ?? markdownDirectory)
                    : null;
                  if (!linkedFile || !onOpenFile) {
                    return (
                      <a href={href} {...props}>
                        {children}
                      </a>
                    );
                  }

                  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
                    if (event.defaultPrevented || event.button !== 0) return;
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    onOpenFile(linkedFile, sourceSessionId);
                  };

                  return (
                    <a href={href} {...props} onClick={handleClick}>
                      {children}
                    </a>
                  );
                },
                img({ src, alt, ...props }) {
                  delete props.node;
                  if (typeof src !== "string") return null;
                  return (
                    <MarkdownImage
                      src={src}
                      alt={alt}
                      baseDir={markdownDirectory}
                      relativeRoot={cwd ?? markdownDirectory}
                      sourceSessionId={sourceSessionId}
                      imgProps={props}
                    />
                  );
                },
              }}
            >
              {markdownPreview}
            </ReactMarkdown>
          </div>
        ) : (
          <SourceView
            content={content}
            language={language}
            wrapLines={wrapLines}
            isDark={isDark}
            translations={translationRows}
            translationLabel={t("comments.translationPrefix")}
          />
        )}
      </div>
    </div>
  );
}
