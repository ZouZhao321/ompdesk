"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { RewindEntry } from "@/lib/rewind";

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
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // The composer keeps focus after `/rewind`, so the picker claims it
  // explicitly; otherwise typing and Enter would still reach the hidden
  // textarea and could send a prompt.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Stop here so the global Esc shortcut cannot abort the session behind
        // the open picker.
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"));
      if (buttons.length === 0) {
        event.preventDefault();
        return;
      }
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      const active = document.activeElement;
      // Focus outside the buttons (the container or the page behind it) re-enters
      // the picker instead of escaping the modal.
      if (!(active instanceof HTMLButtonElement) || !dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rewind-title"
        tabIndex={-1}
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
          outline: "none",
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
