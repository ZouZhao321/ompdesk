"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  commentEntryKey,
  translationTargetLanguage,
  type CommentEntry,
  type CommentLanguage,
} from "@/lib/comment-entries";
import type { CommentTranslationRecord } from "@/lib/comment-dictionary";
import { MOBILE_HIT_TARGET_PX } from "@/lib/mobile-layout";

interface Props {
  cwd?: string;
  /** 只有可见的标签才发起扫描请求，遵循右侧面板的活动约定。 */
  active: boolean;
}

interface LoadedComments {
  cwd: string;
  entries: CommentEntry[];
  excluded: number;
  translations: Record<string, CommentTranslationRecord>;
}

interface CommentEntriesResponse {
  entries: CommentEntry[];
  excluded: number;
  translations: Record<string, CommentTranslationRecord>;
}

interface EditingTranslation {
  key: string;
  entry: CommentEntry;
  targetLanguage: CommentLanguage;
  value: string;
}

const messageStyle = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  color: "var(--text-dim)",
  fontSize: 12,
  textAlign: "center",
} as const;

const entryTextStyle = {
  fontSize: 12,
  lineHeight: 1.5,
  color: "var(--text)",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
} as const;

const translationButtonStyle = {
  ...entryTextStyle,
  display: "block",
  width: "100%",
  padding: 0,
  border: "none",
  background: "transparent",
  fontFamily: "inherit",
  textAlign: "left",
  cursor: "text",
} as const;

const actionButtonStyle = {
  fontFamily: "inherit",
  fontSize: 11,
  padding: "2px 8px",
  borderRadius: 4,
  border: "1px solid var(--border)",
  background: "var(--bg-panel)",
  color: "var(--text)",
  cursor: "pointer",
} as const;

const editorStyle = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
  fontSize: 12,
  lineHeight: 1.5,
  padding: "4px 6px",
  borderRadius: 4,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  resize: "vertical",
} as const;

const sourceBadgeStyle = {
  display: "inline-block",
  marginTop: 3,
  padding: "0 4px",
  border: "1px solid currentColor",
  borderRadius: 3,
  fontSize: 10,
  lineHeight: 1.4,
} as const;

export function CommentTranslationPanel({ cwd, active }: Props) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [loaded, setLoaded] = useState<LoadedComments | null>(null);
  const [loading, setLoading] = useState(false);
  const [failedCwd, setFailedCwd] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingTranslation | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);

  useEffect(() => {
    if (!active || !cwd) return;
    const controller = new AbortController();
    setLoading(true);
    setFailedCwd(null);
    fetch(`/api/comment-entries?cwd=${encodeURIComponent(cwd)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as CommentEntriesResponse;
      })
      .then((payload) => setLoaded({
        cwd,
        entries: payload.entries,
        excluded: payload.excluded,
        translations: payload.translations,
      }))
      .catch(() => {
        if (!controller.signal.aborted) setFailedCwd(cwd);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [active, cwd]);

  // 切换项目时丢弃上一项目的编辑状态，避免把译文写进看不见的项目。
  useEffect(() => {
    setEditing(null);
    setSaveError(null);
  }, [cwd]);

  const beginEdit = (entry: CommentEntry, targetLanguage: CommentLanguage, key: string, value: string) => {
    setSaveError(null);
    setEditing({ key, entry, targetLanguage, value });
  };

  async function saveTranslation(edit: EditingTranslation) {
    const translation = edit.value.trim();
    if (!translation) {
      setSaveError(t("comments.emptyTranslation"));
      return;
    }
    setSavingKey(edit.key);
    setSaveError(null);
    try {
      const response = await fetch("/api/comment-dictionary", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          original: edit.entry.text,
          originalLanguage: edit.entry.language,
          targetLanguage: edit.targetLanguage,
          translation,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const record = (await response.json()) as CommentTranslationRecord;
      setLoaded((previous) => previous && previous.cwd === cwd
        ? { ...previous, translations: { ...previous.translations, [record.key]: record } }
        : previous);
      setEditing(null);
    } catch {
      setSaveError(t("comments.saveFailed"));
    } finally {
      setSavingKey(null);
    }
  }

  async function deleteDictionary() {
    if (!window.confirm(t("comments.deleteDictionaryConfirm"))) return;
    setDeleting(true);
    setDeleteFailed(false);
    try {
      const response = await fetch("/api/comment-dictionary", { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setLoaded((previous) => previous && previous.cwd === cwd
        ? { ...previous, translations: {} }
        : previous);
      setEditing(null);
    } catch {
      setDeleteFailed(true);
    } finally {
      setDeleting(false);
    }
  }

  if (!cwd) return <div style={messageStyle}>{t("files.noProject")}</div>;

  // 只显示当前项目的词条：切换项目时旧响应不会进入画面。
  const current = loaded?.cwd === cwd ? loaded : null;
  const failed = failedCwd === cwd;
  const translatedCount = current ? Object.keys(current.translations).length : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ flexShrink: 0, padding: "8px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, fontSize: 12, color: "var(--text)" }}>
            {current
              ? t("comments.summary", { total: current.entries.length, excluded: current.excluded })
              : t("comments.loading")}
          </div>
          {translatedCount > 0 && (
            <button
              type="button"
              onClick={() => void deleteDictionary()}
              disabled={deleting}
              style={{
                ...actionButtonStyle,
                color: "var(--danger)",
                minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined,
              }}
            >
              {t("comments.deleteDictionary")}
            </button>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>{t("comments.scope")}</div>
        {deleteFailed && (
          <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 2 }}>{t("comments.deleteFailed")}</div>
        )}
      </div>
      <div style={{
        flexShrink: 0,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10,
        padding: "4px 12px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)",
        color: "var(--text-dim)",
        fontSize: 10,
        fontWeight: 600,
      }}>
        <span>{t("comments.zhColumn")}</span>
        <span>{t("comments.enColumn")}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {failed && (
          <div style={messageStyle}>{t("comments.error")}</div>
        )}
        {!failed && !current && loading && (
          <div style={messageStyle}>{t("comments.loading")}</div>
        )}
        {!failed && current && current.entries.length === 0 && (
          <div style={messageStyle}>{t("comments.empty")}</div>
        )}
        {!failed && current?.entries.map((entry) => {
          const targetLanguage = translationTargetLanguage(entry.language);
          const key = commentEntryKey(entry.text, targetLanguage);
          const record = current.translations[key];
          const activeEdit = editing && editing.key === key ? editing : null;
          const originalColumn = <div style={entryTextStyle}>{entry.text}</div>;
          const translationColumn = (
            <div>
              {activeEdit ? (
                <>
                  <textarea
                    autoFocus
                    value={activeEdit.value}
                    onChange={(event) => setEditing({ ...activeEdit, value: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setEditing(null);
                      } else if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void saveTranslation(activeEdit);
                      }
                    }}
                    placeholder={t("comments.translationPlaceholder")}
                    style={{
                      ...editorStyle,
                      minHeight: isMobile ? MOBILE_HIT_TARGET_PX : 60,
                    }}
                  />
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    <button
                      type="button"
                      disabled={savingKey === key}
                      onClick={() => void saveTranslation(activeEdit)}
                      style={{
                        ...actionButtonStyle,
                        minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined,
                      }}
                    >
                      {t("comments.save")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      style={{
                        ...actionButtonStyle,
                        minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined,
                      }}
                    >
                      {t("comments.cancel")}
                    </button>
                  </div>
                  {saveError && (
                    <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 3 }}>{saveError}</div>
                  )}
                </>
              ) : record ? (
                <>
                  <button
                    type="button"
                    title={t("comments.editTranslation")}
                    onClick={() => beginEdit(entry, targetLanguage, key, record.translation)}
                    style={translationButtonStyle}
                  >
                    {record.translation}
                  </button>
                  <span style={{
                    ...sourceBadgeStyle,
                    color: record.origin === "manual" ? "var(--accent)" : "var(--text-dim)",
                  }}>
                    {record.origin === "manual" ? t("comments.sourceManual") : t("comments.sourceModel")}
                  </span>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => beginEdit(entry, targetLanguage, key, "")}
                  style={{
                    ...translationButtonStyle,
                    color: "var(--text-dim)",
                    minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined,
                  }}
                >
                  {t("comments.addTranslation")}
                </button>
              )}
            </div>
          );

          return (
            <div
              key={`${entry.filePath}:${entry.startLine}`}
              style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}
            >
              <div style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-dim)",
                overflowWrap: "anywhere",
              }}>
                {entry.filePath}:{entry.startLine}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 3 }}>
                {entry.language === "zh" ? originalColumn : translationColumn}
                {entry.language === "en" ? originalColumn : translationColumn}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
