"use client";

import { useEffect } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { RewindEntry, RewindEntryKind } from "@/lib/rewind";

const ROLE_LABEL_KEYS: Record<RewindEntryKind, string> = {
  user: "chat.rewindRoleUser",
  assistant: "chat.rewindRoleAssistant",
  tool: "chat.rewindRoleTool",
  other: "chat.rewindRoleOther",
};

export function RewindDialog({
  entries,
  onSelect,
  onClose,
}: {
  entries: RewindEntry[];
  onSelect: (entryId: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0,0,0,0.4)",
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rewind-title"
        style={{
          width: 560,
          maxWidth: "100%",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg-panel)",
          boxShadow: "0 12px 36px rgba(0,0,0,0.24)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "16px 18px 10px" }}>
          <div id="rewind-title" style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
            {t("chat.rewindTitle")}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.6, color: "var(--text-muted)" }}>
            {t("chat.rewindHint")}
          </div>
        </div>

        <div style={{ minHeight: 0, overflowY: "auto", padding: "0 10px 10px" }}>
          {entries.length === 0 ? (
            <div style={{ padding: "20px 8px", fontSize: 12, color: "var(--text-muted)" }}>
              {t("chat.rewindEmpty")}
            </div>
          ) : entries.map((entry) => (
            <button
              key={entry.entryId}
              type="button"
              onClick={() => onSelect(entry.entryId)}
              style={{
                display: "block",
                width: "100%",
                marginTop: 6,
                padding: "9px 10px",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "transparent",
                color: "var(--text)",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span
                  style={{
                    flexShrink: 0,
                    padding: "1px 6px",
                    borderRadius: 4,
                    border: "1px solid var(--border)",
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: 0.4,
                    textTransform: "uppercase",
                    color: "var(--text-muted)",
                  }}
                >
                  {t(ROLE_LABEL_KEYS[entry.kind])}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 13,
                  }}
                >
                  {entry.text}
                </span>
                {entry.images.length > 0 && (
                  <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-muted)" }}>
                    {t("chat.rewindImages", { count: entry.images.length })}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
