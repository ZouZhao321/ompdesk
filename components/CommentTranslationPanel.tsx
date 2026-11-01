"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { CommentEntry } from "@/lib/comment-entries";

interface Props {
  cwd?: string;
  /** 只有可见的标签才发起扫描请求，遵循右侧面板的活动约定。 */
  active: boolean;
}

interface LoadedComments {
  cwd: string;
  entries: CommentEntry[];
  excluded: number;
}

interface CommentEntriesResponse {
  entries: CommentEntry[];
  excluded: number;
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

export function CommentTranslationPanel({ cwd, active }: Props) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState<LoadedComments | null>(null);
  const [loading, setLoading] = useState(false);
  const [failedCwd, setFailedCwd] = useState<string | null>(null);

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
      .then((payload) => setLoaded({ cwd, entries: payload.entries, excluded: payload.excluded }))
      .catch(() => {
        if (!controller.signal.aborted) setFailedCwd(cwd);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [active, cwd]);

  if (!cwd) return <div style={messageStyle}>{t("files.noProject")}</div>;

  // 只显示当前项目的词条：切换项目时旧响应不会进入画面。
  const current = loaded?.cwd === cwd ? loaded : null;
  const failed = failedCwd === cwd;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ flexShrink: 0, padding: "8px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
        <div style={{ fontSize: 12, color: "var(--text)" }}>
          {current
            ? t("comments.summary", { total: current.entries.length, excluded: current.excluded })
            : t("comments.loading")}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>{t("comments.scope")}</div>
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
        {!failed && current?.entries.map((entry) => (
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
              <div style={entryTextStyle}>{entry.language === "zh" ? entry.text : ""}</div>
              <div style={entryTextStyle}>{entry.language === "en" ? entry.text : ""}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
