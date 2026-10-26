"use client";

import { useCallback, useEffect, useRef, type FocusEvent, type KeyboardEventHandler, type RefObject } from "react";
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
  /** 焦点离开整个控件时调用：菜单只在这里收起，Tab 键留给浏览器处理。 */
  onDismiss?: () => void;
  onSelectMode: (mode: ProjectSortMode) => void;
}

const SORT_MODES: readonly ProjectSortMode[] = ["time", "name"];

/** 排序菜单里一次按键要做的动作：把焦点移到某一项，或关闭菜单。 */
export type SortMenuKeyAction =
  | { kind: "focus"; index: number }
  | { kind: "close" };

/**
 * 排序菜单的键盘映射：方向键在选项间循环、Home/End 跳到首尾、
 * Escape 关闭并把焦点交回触发按钮。其他按键（含 Tab）返回 null，
 * 保留浏览器默认行为，让焦点按顺序离开菜单。
 */
export function sortMenuKeyAction(key: string, currentIndex: number, count: number): SortMenuKeyAction | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowDown":
      return { kind: "focus", index: currentIndex < 0 ? 0 : (currentIndex + 1) % count };
    case "ArrowUp":
      return { kind: "focus", index: currentIndex <= 0 ? count - 1 : currentIndex - 1 };
    case "Home":
      return { kind: "focus", index: 0 };
    case "End":
      return { kind: "focus", index: count - 1 };
    case "Escape":
      return { kind: "close" };
    default:
      return null;
  }
}

/**
 * 侧边栏「项目」标题右侧的排序控件：只消费当前排序方式与开关状态，
 * 本地存储与列表排序都由调用方处理。
 */
export function ProjectSortControl({ mode, open, menuRef, onToggle, onDismiss, onSelectMode }: Props) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // 打开后把焦点交给已选中的排序方式，键盘用户可以从当前位置继续。
  // 双 rAF 与 AnimatedDropdown 的挂载时机对齐：首次打开时菜单项在下一帧才存在。
  useEffect(() => {
    if (!open) return;
    const checked = SORT_MODES.indexOf(mode);
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        itemRefs.current[checked >= 0 ? checked : 0]?.focus();
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, mode]);

  const handleMenuKeyDown = useCallback<KeyboardEventHandler<HTMLDivElement>>((event) => {
    const items = itemRefs.current;
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    const action = sortMenuKeyAction(event.key, currentIndex, items.length);
    if (action === null) return;
    event.preventDefault();
    if (action.kind === "focus") {
      items[action.index]?.focus();
      return;
    }
    // Escape 只收起菜单：阻止冒泡，避免全局 Esc 快捷键连带中止正在运行的 agent。
    event.stopPropagation();
    onToggle();
    triggerRef.current?.focus();
  }, [onToggle]);

  // 选中即关闭菜单，焦点回到触发按钮，避免焦点随关闭的菜单项一起消失。
  const selectMode = useCallback((option: ProjectSortMode) => {
    onSelectMode(option);
    triggerRef.current?.focus();
  }, [onSelectMode]);

  // 焦点离开整个控件时才收起菜单：此时浏览器已经完成 Tab 的焦点移动，
  // 菜单项退出占位不会再把焦点甩到 body 上。
  const handleBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (!open || event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    onDismiss?.();
  }, [open, onDismiss]);

  return (
    <div ref={menuRef} onBlur={handleBlur} style={{ position: "relative", display: "flex", flexShrink: 0, marginRight: 6 }}>
      <button
        ref={triggerRef}
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
        onKeyDown={handleMenuKeyDown}
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
        {SORT_MODES.map((option, index) => (
          <button
            key={option}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            type="button"
            role="menuitemradio"
            aria-checked={mode === option}
            // 菜单项只靠方向键漫游聚焦，Tab 直接离开整个控件。
            tabIndex={-1}
            onClick={() => selectMode(option)}
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
