"use client";

import type { RefObject } from "react";
import { useI18n } from "@/hooks/useI18n";
import { MOBILE_HIT_TARGET_PX, useIsMobile } from "@/hooks/useIsMobile";
import type { ProjectSortMode } from "@/lib/project-order";
import { AnimatedDropdown } from "./AnimatedDropdown";

interface Props {
  mode: ProjectSortMode;
  open: boolean;
  /** 父组件用它在菜单打开期间判断外部点击。 */
  menuRef?: RefObject<HTMLDivElement | null>;
  onToggle: () => void;
  onSelectMode: (mode: ProjectSortMode) => void;
}

const SORT_MODES: readonly ProjectSortMode[] = ["time", "name"];

/**
 * 侧边栏「项目」标题右侧的排序控件：只消费当前排序方式与开关状态，
 * 本地存储与列表排序都由调用方处理。
 */
export function ProjectSortControl({ mode, open, menuRef, onToggle, onSelectMode }: Props) {
  const { t } = useI18n();
  const isMobile = useIsMobile();

  return (
    <div ref={menuRef} style={{ position: "relative", display: "flex", flexShrink: 0, marginRight: 6 }}>
      <button
        type="button"
        onClick={onToggle}
        title={t("sidebar.projectSort")}
        aria-label={t("sidebar.projectSort")}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          minWidth: isMobile ? MOBILE_HIT_TARGET_PX : undefined,
          minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined,
          padding: 0,
          border: "none",
          borderRadius: 6,
          background: open ? "var(--bg-selected)" : "var(--bg-hover)",
          color: open ? "var(--accent)" : "var(--text-muted)",
          cursor: "pointer",
          transition: "background 0.12s, color 0.12s",
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.color = open ? "var(--accent)" : "var(--text-muted)";
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 6h9M4 12h6M4 18h3" />
          <path d="M17 5v14M14 16l3 3 3-3" />
        </svg>
      </button>
      <AnimatedDropdown
        open={open}
        role="menu"
        style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          right: 0,
          width: 160,
          zIndex: 120,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          boxShadow: "0 6px 20px rgba(0,0,0,0.14)",
          overflow: "hidden",
        }}
      >
        {SORT_MODES.map((option) => (
          <button
            key={option}
            type="button"
            role="menuitemradio"
            aria-checked={mode === option}
            onClick={() => onSelectMode(option)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              minHeight: isMobile ? MOBILE_HIT_TARGET_PX : 34,
              padding: "0 10px",
              border: "none",
              background: mode === option ? "var(--bg-selected)" : "transparent",
              color: mode === option ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer",
              textAlign: "left",
              fontSize: 12,
            }}
          >
            <span style={{ display: "flex", width: 12, color: "var(--accent)", flexShrink: 0 }}>
              {mode === option && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </span>
            {t(option === "time" ? "sidebar.sortByTime" : "sidebar.sortByName")}
          </button>
        ))}
      </AnimatedDropdown>
    </div>
  );
}
