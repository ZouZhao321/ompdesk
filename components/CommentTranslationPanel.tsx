"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  commentTranslationKey,
  translationTargetLanguage,
  type CommentEntry,
  type CommentLanguage,
} from "@/lib/comment-entries";
import type { CommentTranslationRecord } from "@/lib/comment-dictionary";
import type { CommentTranslationRequestEntry } from "@/lib/comment-translation-generation";
import {
  chunkCommentTranslationEntries,
  commentTranslationErrorKey,
  type CommentTranslationErrorKey,
} from "@/lib/comment-translation-request";
import type { ProtectedFragment } from "@/lib/comment-translation-validation";
import { MOBILE_HIT_TARGET_PX } from "@/lib/mobile-layout";
import { CommentTranslationPreview } from "./CommentTranslationPreview";

interface Props {
  cwd?: string;
  /** 只有可见的标签才发起扫描请求，遵循右侧面板的活动约定。 */
  active: boolean;
}

interface LoadedComments {
  cwd: string;
  entries: CommentEntry[];
  excluded: number;
  files: number;
  translations: Record<string, CommentTranslationRecord>;
}

interface CommentEntriesResponse {
  entries: CommentEntry[];
  excluded: number;
  files: number;
  translations: Record<string, CommentTranslationRecord>;
}

interface EditingTranslation {
  key: string;
  entry: CommentEntry;
  targetLanguage: CommentLanguage;
  value: string;
}

type RowFailure = ProtectedFragment[] | "noOutput";

interface CommentTranslationResult {
  key: string;
  status: "generated" | "cached" | "failed";
  reason?: "no_output" | "missing_fragments";
  missing?: ProtectedFragment[];
}

interface GenerateResponse {
  model: string;
  results: CommentTranslationResult[];
  translations: Record<string, CommentTranslationRecord>;
}

/** 行身份用文件与起始行，同一句原文出现在两个文件里时仍能分别勾选。 */
function rowId(entry: CommentEntry): string {
  return `${entry.filePath}\u0000${entry.startLine}`;
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
  display: "flex",
  alignItems: "center",
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

const toolbarRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginTop: 6,
} as const;

const fileHeaderStyle = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 12px",
  borderBottom: "1px solid var(--border)",
  background: "var(--bg-panel)",
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  color: "var(--text-dim)",
  overflowWrap: "anywhere",
} as const;

const rowHeaderStyle = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  color: "var(--text-dim)",
} as const;

const failureStyle = {
  marginTop: 3,
  fontSize: 11,
  color: "var(--danger)",
  overflowWrap: "anywhere",
} as const;

/** 两栏各自可收缩，长单词只在栏内换行，不会把邻栏挤出去。 */
const columnStyle = {
  minWidth: 0,
} as const;

/**
 * 复选输入的命中区。移动档把 label 撑到命中区尺寸，输入本身保持原尺寸；
 * 桌面档 label 收缩到输入自身的尺寸。
 */
const checkboxHitBoxStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  cursor: "pointer",
} as const;

export function CommentTranslationPanel({ cwd, active }: Props) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  // 移动档控件的命中区边长；桌面档保持各控件原本的尺寸。
  const hitTarget = isMobile ? MOBILE_HIT_TARGET_PX : undefined;
  const [loaded, setLoaded] = useState<LoadedComments | null>(null);
  const [loading, setLoading] = useState(false);
  const [failedCwd, setFailedCwd] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingTranslation | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<CommentTranslationErrorKey | null>(null);
  const [rowFailures, setRowFailures] = useState<Record<string, RowFailure>>({});

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
      .then((payload) => {
        setLoaded({
          cwd,
          entries: payload.entries,
          excluded: payload.excluded,
          files: payload.files,
          translations: payload.translations,
        });
        // 重新扫描后丢弃已不存在的行，勾选数量与实际条目保持一致。
        setSelected((previous) => {
          const visibleIds = new Set(payload.entries.map(rowId));
          const next = new Set([...previous].filter((id) => visibleIds.has(id)));
          return next.size === previous.size ? previous : next;
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailedCwd(cwd);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [active, cwd]);

  // 切换项目时丢弃上一项目的编辑与勾选状态，避免把译文写进看不见的项目。
  useEffect(() => {
    setEditing(null);
    setSaveError(null);
    setSelected(new Set());
    setGenerateError(null);
    setRowFailures({});
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

  const toggleSelection = (ids: readonly string[], checked: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  async function generateSelected() {
    if (generating) return;
    const loadedHere = loaded?.cwd === cwd ? loaded : null;
    if (!loadedHere) return;
    const rows = loadedHere.entries.filter((entry) => selected.has(rowId(entry)));
    if (rows.length === 0) return;

    // 同一句原文同一目标语言只发一次；勾选行一律强制重新生成，覆盖已有译文。
    const seenKeys = new Set<string>();
    const entries: CommentTranslationRequestEntry[] = [];
    for (const entry of rows) {
      const key = commentTranslationKey(entry);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      entries.push({
        original: entry.text,
        originalLanguage: entry.language,
        targetLanguage: translationTargetLanguage(entry.language),
        force: true,
      });
    }

    setGenerating(true);
    setGenerateError(null);
    setRowFailures({});
    const failures: Record<string, RowFailure> = {};
    const translations: Record<string, CommentTranslationRecord> = {};
    let error: CommentTranslationErrorKey | null = null;
    try {
      // 服务端单次请求有条目上限，整页勾选按上限顺序分批，结果合并后再显示。
      for (const batch of chunkCommentTranslationEntries(entries)) {
        const response = await fetch("/api/comment-translations/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entries: batch }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { code?: unknown } | null;
          error = commentTranslationErrorKey(payload?.code);
          break;
        }
        const payload = (await response.json()) as GenerateResponse;
        Object.assign(translations, payload.translations);
        for (const result of payload.results) {
          if (result.status !== "failed") continue;
          failures[result.key] = result.reason === "no_output" ? "noOutput" : (result.missing ?? []);
        }
      }
    } catch {
      error = commentTranslationErrorKey(undefined);
    } finally {
      setLoaded((previous) => previous && previous.cwd === cwd
        ? { ...previous, translations: { ...previous.translations, ...translations } }
        : previous);
      setRowFailures(failures);
      setGenerateError(error);
      setGenerating(false);
    }
  }

  if (!cwd) return <div style={messageStyle}>{t("files.noProject")}</div>;

  // 只显示当前项目的词条：切换项目时旧响应不会进入画面。
  const current = loaded?.cwd === cwd ? loaded : null;
  const failed = failedCwd === cwd;
  const translatedCount = current ? Object.keys(current.translations).length : 0;
  const allSelected = Boolean(
    current
    && current.entries.length > 0
    && current.entries.every((entry) => selected.has(rowId(entry))),
  );

  // 按文件分组，文件头提供按文件全选。
  const groups: Array<{ filePath: string; rows: CommentEntry[] }> = [];
  for (const entry of current?.entries ?? []) {
    const last = groups.at(-1);
    if (last && last.filePath === entry.filePath) last.rows.push(entry);
    else groups.push({ filePath: entry.filePath, rows: [entry] });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ flexShrink: 0, padding: "8px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, fontSize: 12, color: "var(--text)" }}>
            {current
              ? t("comments.summary", {
                files: current.files,
                total: current.entries.length,
                excluded: current.excluded,
              })
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
                minHeight: hitTarget,
              }}
            >
              {t("comments.deleteDictionary")}
            </button>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>{t("comments.scope")}</div>
        <div style={toolbarRowStyle}>
          <label style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            color: "var(--text-dim)",
            minHeight: hitTarget,
          }}>
            <input
              type="checkbox"
              checked={allSelected}
              disabled={!current || current.entries.length === 0}
              onChange={(event) => toggleSelection(
                current ? current.entries.map(rowId) : [],
                event.target.checked,
              )}
            />
            {t("comments.selectAll")}
          </label>
          <div style={{ flex: 1, fontSize: 11, color: "var(--text-dim)" }}>
            {t("comments.selectedCount", { selected: selected.size })}
          </div>
          <button
            type="button"
            onClick={() => void generateSelected()}
            disabled={generating || selected.size === 0}
            style={{
              ...actionButtonStyle,
              minHeight: hitTarget,
            }}
          >
            {generating
              ? t("comments.generating")
              : t("comments.generateSelected", { count: selected.size })}
          </button>
        </div>
        {deleteFailed && (
          <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 2 }}>{t("comments.deleteFailed")}</div>
        )}
        {generateError && (
          <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 2 }}>
            {t(generateError)}
          </div>
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
        {!failed && current && groups.map((group) => {
          const groupSelected = group.rows.every((entry) => selected.has(rowId(entry)));
          return (
            <div key={group.filePath}>
              <div style={fileHeaderStyle}>
                <label style={{ ...checkboxHitBoxStyle, minWidth: hitTarget, minHeight: hitTarget }}>
                  <input
                    type="checkbox"
                    checked={groupSelected}
                    onChange={(event) => toggleSelection(group.rows.map(rowId), event.target.checked)}
                    title={t("comments.selectFile")}
                    aria-label={`${t("comments.selectFile")}: ${group.filePath}`}
                  />
                </label>
                <span>{group.filePath}</span>
              </div>
              {group.rows.map((entry) => {
                const targetLanguage = translationTargetLanguage(entry.language);
                const key = commentTranslationKey(entry);
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
                            minHeight: hitTarget ?? 60,
                          }}
                        />
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          <button
                            type="button"
                            disabled={savingKey === key}
                            onClick={() => void saveTranslation(activeEdit)}
                            style={{
                              ...actionButtonStyle,
                              minWidth: hitTarget,
                              minHeight: hitTarget,
                            }}
                          >
                            {t("comments.save")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing(null)}
                            style={{
                              ...actionButtonStyle,
                              minWidth: hitTarget,
                              minHeight: hitTarget,
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
                          style={{ ...translationButtonStyle, minHeight: hitTarget }}
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
                          minHeight: hitTarget,
                        }}
                      >
                        {t("comments.addTranslation")}
                      </button>
                    )}
                    {rowFailures[key] && (
                      <div style={failureStyle}>
                        {rowFailures[key] === "noOutput"
                          ? t("comments.noOutput")
                          : t("comments.missingFragments", {
                            missing: rowFailures[key].map((fragment) => fragment.value).join(", "),
                          })}
                      </div>
                    )}
                  </div>
                );

                const id = rowId(entry);
                return (
                  <div
                    key={id}
                    style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}
                  >
                    <div style={rowHeaderStyle}>
                      <label style={{ ...checkboxHitBoxStyle, minWidth: hitTarget, minHeight: hitTarget }}>
                        <input
                          type="checkbox"
                          checked={selected.has(id)}
                          onChange={(event) => toggleSelection([id], event.target.checked)}
                          aria-label={`${t("comments.selectEntry")}: ${entry.filePath}:${entry.startLine}`}
                        />
                      </label>
                      <span>{t("comments.line", { line: entry.startLine })}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 3 }}>
                      <div style={columnStyle}>
                        {entry.language === "zh" ? originalColumn : translationColumn}
                      </div>
                      <div style={columnStyle}>
                        {entry.language === "en" ? originalColumn : translationColumn}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {current && (
        <CommentTranslationPreview
          cwd={cwd}
          entries={current.entries}
          translations={current.translations}
        />
      )}
    </div>
  );
}
