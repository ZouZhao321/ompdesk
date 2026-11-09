"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useCommentTranslationPreference } from "@/hooks/useCommentTranslation";
import { notifyCommentDictionaryChanged } from "@/lib/comment-dictionary-version";
import { commentTranslationTarget } from "@/lib/comment-translation-render";
import { commentTranslationKey, type CommentEntry } from "@/lib/comment-entries";
import type { CommentTranslationRecord } from "@/lib/comment-dictionary";
import { getFileExt } from "@/lib/file-types";
import { getFileApiUrl, joinFilePath } from "@/lib/file-paths";
import { useSourceWrapLines } from "@/hooks/useSourceWrapLines";
import { SourceView } from "./SourceCodeView";

interface Props {
  cwd: string;
  entries: readonly CommentEntry[];
  translations: Record<string, CommentTranslationRecord>;
}

interface PreviewCandidate {
  id: string;
  entry: CommentEntry;
  key: string | null;
}

/**
 * 面板底部的预览窗口：用查看器同一份 SourceView 渲染选中的词条，
 * 从源码里截取该注释块，行号沿用文件中的真实行号。
 */
export function CommentTranslationPreview({ cwd, entries, translations }: Props) {
  const { t, locale } = useI18n();
  const { isDark } = useTheme();
  const viewerEnabled = useCommentTranslationPreference();
  const wrapLines = useSourceWrapLines();
  const targetLanguage = commentTranslationTarget(locale);

  // 面板保存译文后递增字典版本，已打开的查看器不必重新加载文件即可取到新译文。
  useEffect(() => {
    notifyCommentDictionaryChanged();
  }, [translations]);

  const candidates = useMemo<PreviewCandidate[]>(
    () =>
      entries.map((entry) => ({
        id: `${entry.filePath}:${entry.startLine}`,
        entry,
        key: entry.language === targetLanguage ? null : commentTranslationKey(entry),
      })),
    [entries, targetLanguage],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    candidates.find((candidate) => candidate.id === selectedId) ??
    candidates.find((candidate) => candidate.key !== null && translations[candidate.key]) ??
    candidates[0] ??
    null;

  const [source, setSource] = useState<{ path: string; content: string } | null>(null);
  const [sourceFailed, setSourceFailed] = useState(false);
  const absolutePath = selected ? joinFilePath(cwd, selected.entry.filePath) : null;

  useEffect(() => {
    if (!absolutePath) {
      setSource(null);
      setSourceFailed(false);
      return;
    }

    const controller = new AbortController();
    setSourceFailed(false);
    fetch(getFileApiUrl(absolutePath, "read"), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as { content?: string };
      })
      .then((payload) => {
        if (typeof payload.content !== "string") throw new Error("Missing content");
        setSource({ path: absolutePath, content: payload.content });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setSource(null);
        setSourceFailed(true);
      });

    return () => controller.abort();
  }, [absolutePath]);

  const record = selected?.key ? translations[selected.key] : undefined;
  const loaded = selected && source?.path === absolutePath ? source.content : null;

  const snippet = useMemo(() => {
    if (!loaded || !selected) return "";
    return loaded
      .split("\n")
      .slice(selected.entry.startLine - 1, selected.entry.endLine)
      .join("\n");
  }, [loaded, selected]);

  const previewTranslations = useMemo(() => {
    if (!viewerEnabled || !selected || !record) return null;
    return new Map<number, string>([[selected.entry.endLine, record.translation]]);
  }, [record, selected, viewerEnabled]);

  if (candidates.length === 0 || !selected) return null;

  return (
    <div
      style={{
        flexShrink: 0,
        padding: "8px 12px",
        borderTop: "1px solid var(--border)",
        background: "var(--bg-panel)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: "var(--text-dim)" }}>
          {t("comments.previewTitle")}
        </span>
        <select
          aria-label={t("comments.previewSelect")}
          value={selected.id}
          onChange={(event) => setSelectedId(event.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "2px 4px",
            border: "1px solid var(--border)",
            borderRadius: 4,
            background: "var(--bg)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
          }}
        >
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.entry.filePath}:{candidate.entry.startLine}
            </option>
          ))}
        </select>
        <span style={{ flexShrink: 0, fontSize: 10, color: "var(--text-dim)" }}>
          {targetLanguage === "zh" ? t("comments.zhColumn") : t("comments.enColumn")}
        </span>
      </div>

      <div
        style={{
          marginTop: 6,
          maxHeight: 200,
          overflow: "auto",
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--bg)",
        }}
      >
        {sourceFailed ? (
          <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--danger)" }}>
            {t("comments.previewFailed")}
          </div>
        ) : loaded === null ? (
          <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--text-dim)" }}>
            {t("comments.previewLoading")}
          </div>
        ) : (
          <SourceView
            content={snippet}
            language={getFileExt(selected.entry.filePath) === "tsx" ? "tsx" : "typescript"}
            wrapLines={wrapLines}
            isDark={isDark}
            firstLineNumber={selected.entry.startLine}
            translations={previewTranslations}
            translationLabel={t("comments.translationPrefix")}
          />
        )}
      </div>

      {!viewerEnabled ? (
        <div style={{ marginTop: 4, fontSize: 10, color: "var(--text-dim)" }}>{t("comments.previewHidden")}</div>
      ) : !record ? (
        <div style={{ marginTop: 4, fontSize: 10, color: "var(--text-dim)" }}>{t("comments.previewEmpty")}</div>
      ) : null}
    </div>
  );
}
