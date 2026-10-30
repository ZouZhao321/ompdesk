"use client";

import { useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MOBILE_HIT_TARGET_PX } from "@/lib/mobile-layout";
import { useI18n } from "@/hooks/useI18n";
import type { TranslationParams } from "@/lib/i18n/types";
import { STATIC_MARKER_APPEARANCE, STATIC_MARKER_STATUSES, type StaticMarkerCounts } from "@/lib/session-marker";

/**
 * 项目行展示的活动计数：运行中、等待回答与未读会话。
 *
 * 未读部分按静态状态分组，颜色与单个会话行的静态标记出自同一张外观表，
 * 项目行汇总与行内灯因此不会出现同一状态两种颜色。
 */
export interface ProjectActivity {
  running: number;
  waiting: number;
  /** 未读会话按静态状态分组的计数；没有命中的状态不出现。 */
  unread: StaticMarkerCounts;
}

interface Props {
  /** 项目根目录的完整路径：作为项目按钮的 title 与新建会话的可访问名。 */
  project: string;
  /** 展示用的项目名（路径最后一段）。 */
  name: string;
  isSelected: boolean;
  isCollapsed: boolean;
  /** 项目已置顶时在项目名旁显示图钉标记。 */
  isPinned?: boolean;
  activity?: ProjectActivity;
  /** 由父组件持有，鼠标进入/离开时通过 onHoverChange 回报。 */
  hovered: boolean;
  menuOpen: boolean;
  /** 父组件用它在菜单打开期间判断外部点击。 */
  menuRef?: RefObject<HTMLDivElement | null>;
  /** 选中的是同一仓库的非主 worktree 时高亮操作按钮。 */
  highlightActions?: boolean;
  onToggleCollapse: () => void;
  onSelect: () => void;
  onNewSession: () => void;
  onToggleMenu: () => void;
  onHoverChange: (hovered: boolean) => void;
  /** 项目操作菜单，由调用方渲染后作为插槽传入。 */
  children?: ReactNode;
}

/**
 * 侧边栏的项目行：只消费展示状态与回调，不读取会话、浏览器存储或网络。
 * 折叠集合、选中项目、悬停状态与菜单开关都由调用方持有。
 */
export function ProjectRow({
  project,
  name,
  isSelected,
  isCollapsed,
  isPinned = false,
  activity,
  hovered,
  menuOpen,
  menuRef,
  highlightActions = false,
  onToggleCollapse,
  onSelect,
  onNewSession,
  onToggleMenu,
  onHoverChange,
  children,
}: Props) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const rowHeight = isMobile ? MOBILE_HIT_TARGET_PX : 34;
  // 键盘用户没有鼠标离开事件，行内焦点自成一套可见性来源。
  const [focusWithin, setFocusWithin] = useState(false);
  // 手机没有悬停态，新建会话与项目操作按钮必须常驻且可点。
  const newSessionVisible = isMobile || hovered || focusWithin;
  const actionsVisible = isMobile || hovered || focusWithin || menuOpen;

  return (
    <div
      ref={menuRef}
      className="sidebar-project-row"
      data-project-path={project}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onFocus={() => setFocusWithin(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusWithin(false);
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        minHeight: rowHeight,
        position: "relative",
        borderRadius: 6,
        background: isSelected ? "var(--bg-hover)" : "transparent",
      }}
    >
      <button
        type="button"
        className="sidebar-project-icon-button"
        onClick={onToggleCollapse}
        title={isCollapsed ? t("sidebar.expandProject") : t("sidebar.collapseProject")}
        aria-label={isCollapsed ? t("sidebar.expandProject") : t("sidebar.collapseProject")}
        aria-expanded={!isCollapsed}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: isMobile ? MOBILE_HIT_TARGET_PX : 24,
          height: isMobile ? MOBILE_HIT_TARGET_PX : 28,
          marginLeft: 2,
          padding: 0,
          border: "none",
          background: "transparent",
          color: "var(--text-dim)",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.12s" }}
        >
          <polyline points="2.5 4 6 7.5 9.5 4" />
        </svg>
      </button>
      <button
        type="button"
        className="sidebar-project-name"
        onClick={onSelect}
        title={project}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flex: 1,
          minWidth: 0,
          height: rowHeight,
          padding: "0 4px",
          border: "none",
          background: "transparent",
          color: isSelected ? "var(--text)" : "var(--text-muted)",
          cursor: "pointer",
          textAlign: "left",
          fontSize: 12.5,
          fontWeight: isSelected ? 600 : 500,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, color: isSelected ? "var(--accent)" : "var(--text-dim)" }}>
          <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />
        </svg>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        {isPinned && (
          <span
            role="img"
            aria-label={t("sidebar.pinnedProject")}
            title={t("sidebar.pinnedProject")}
            style={{ display: "inline-flex", alignItems: "center", flexShrink: 0, color: "var(--text-dim)" }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 17v5" />
              <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
            </svg>
          </span>
        )}
        {showProjectActivity(activity, t)}
      </button>

      <button
        type="button"
        className="sidebar-project-icon-button sidebar-project-icon-reveal"
        onClick={onNewSession}
        title={t("sidebar.newSessionTitle", { path: project })}
        aria-label={t("sidebar.newSessionTitle", { path: project })}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: isMobile ? MOBILE_HIT_TARGET_PX : 28,
          height: isMobile ? MOBILE_HIT_TARGET_PX : 28,
          padding: 0,
          border: "none",
          borderRadius: 5,
          background: "transparent",
          color: "var(--text-dim)",
          cursor: "pointer",
          opacity: newSessionVisible ? 1 : 0,
          pointerEvents: newSessionVisible ? "auto" : "none",
          transition: "opacity 0.12s, background 0.12s, color 0.12s",
          flexShrink: 0,
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = "var(--bg-selected)";
          event.currentTarget.style.color = "var(--accent)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = "transparent";
          event.currentTarget.style.color = "var(--text-dim)";
        }}
      >
        <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <line x1="6" y1="1.5" x2="6" y2="10.5" />
          <line x1="1.5" y1="6" x2="10.5" y2="6" />
        </svg>
      </button>
      <div style={{ position: "static", flexShrink: 0 }}>
        <button
          type="button"
          className="sidebar-project-icon-button sidebar-project-icon-reveal"
          onClick={onToggleMenu}
          title={t("sidebar.projectActions")}
          aria-label={t("sidebar.projectActions")}
          aria-expanded={menuOpen}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: isMobile ? MOBILE_HIT_TARGET_PX : 28,
            height: isMobile ? MOBILE_HIT_TARGET_PX : 28,
            marginRight: 3,
            padding: 0,
            border: "none",
            borderRadius: 5,
            background: menuOpen ? "var(--bg-selected)" : "transparent",
            color: highlightActions ? "var(--accent)" : "var(--text-dim)",
            cursor: "pointer",
            opacity: actionsVisible ? 1 : 0,
            pointerEvents: actionsVisible ? "auto" : "none",
            transition: "opacity 0.12s, background 0.12s, color 0.12s",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
            <circle cx="3" cy="7" r="1.1" />
            <circle cx="7" cy="7" r="1.1" />
            <circle cx="11" cy="7" r="1.1" />
          </svg>
        </button>
      </div>
      {children}
    </div>
  );
}

/**
 * 项目行内的活动计数徽标：运行中（旋转图标 + 计数）、等待回答（黄点 + 计数）、
 * 未读按静态状态分组（每种状态一个点 + 计数，颜色与单个会话的静态标记一致）。
 * 没有活动时什么都不渲染。
 */
function showProjectActivity(
  activity: ProjectActivity | undefined,
  t: (key: string, params?: TranslationParams) => string,
): ReactNode {
  if (!activity) return null;
  if (
    activity.running === 0 &&
    activity.waiting === 0 &&
    !STATIC_MARKER_STATUSES.some((status) => (activity.unread[status] ?? 0) > 0)
  ) {
    return null;
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, marginLeft: 6 }}>
      {activity.running > 0 && (
        <span
          title={t("sidebar.agentRunning")}
          aria-label={t("sidebar.agentRunningWithCount", { count: activity.running })}
          role="img"
          style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--accent)", fontSize: 10, fontFamily: "var(--font-mono)" }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
            <g>
              <path d="M21 12a9 9 0 1 1-3.8-7.4" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
              <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
            </g>
          </svg>
          {activity.running}
        </span>
      )}
      {activity.waiting > 0 && (
        <span
          title={t("sidebar.agentWaitingForInput")}
          aria-label={t("sidebar.agentWaitingForInputWithCount", { count: activity.waiting })}
          role="img"
          style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--warning)", fontSize: 10, fontFamily: "var(--font-mono)" }}
        >
          <svg width="10" height="10" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: "block" }}>
            <circle cx="7" cy="7" r="4" fill="currentColor" />
          </svg>
          {activity.waiting}
        </span>
      )}
      {STATIC_MARKER_STATUSES.map((status) => {
        const count = activity.unread[status] ?? 0;
        if (count === 0) return null;
        const { color, labelKey, countLabelKey } = STATIC_MARKER_APPEARANCE[status];
        return (
          <span
            key={status}
            title={t(labelKey)}
            aria-label={t(countLabelKey, { count })}
            role="img"
            style={{ display: "inline-flex", alignItems: "center", gap: 3, color, fontSize: 10, fontFamily: "var(--font-mono)" }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
            {count}
          </span>
        );
      })}
    </span>
  );
}
