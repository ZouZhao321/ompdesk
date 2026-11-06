"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MOBILE_HIT_TARGET_PX } from "@/lib/mobile-layout";
import type { BranchEntry, WorktreeEntry } from "@/lib/worktree-types";
import { requestWorktreeSwitch } from "@/lib/worktree-switch";
import { AnimatedDropdown } from "./AnimatedDropdown";
import { PathLabel } from "./PathLabel";
import { projectMenuRowStyle } from "./project-menu-row-style";

interface SwitcherState {
  /** 这份数据对应的 cwd，用来拒绝上一个目录的迟到响应与旧操作 */
  forCwd: string;
  projectRoot: string;
  isGit: boolean;
  isTopLevel: boolean;
  worktrees: WorktreeEntry[];
  /** null 表示分支枚举失败；空数组表示仓库没有本地分支 */
  branches: BranchEntry[] | null;
}

interface Props {
  cwd: string | null;
  /** 会话回合结束时递增，触发一次重新读取。 */
  refreshKey?: number;
}

/** 分行时显示筛选框的最少行数。 */
const FILTER_THRESHOLD = 8;

/**
 * Git 面板顶部的分支下拉：显示当前分支，展开后列出分支与已有 checkout。
 * 选中分支复用它的 checkout，没有 checkout 时由接口新建一个。
 */
export function WorktreeSwitcher({ cwd, refreshKey = 0 }: Props) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [state, setState] = useState<SwitcherState | null>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const newInputRef = useRef<HTMLInputElement>(null);

  const closePanel = useCallback(() => {
    setOpen(false);
    setNewOpen(false);
    setNewBranch("");
    setError(null);
    setFilter("");
    setConfirmRemove(null);
  }, []);

  useEffect(() => {
    if (!cwd) {
      setState(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/worktrees?cwd=${encodeURIComponent(cwd)}`)
      .then((response) => response.json())
      .then((data: {
        projectRoot?: string;
        isGit?: boolean;
        isTopLevel?: boolean;
        worktrees?: WorktreeEntry[];
        branches?: BranchEntry[] | null;
        error?: string;
      }) => {
        if (cancelled) return;
        if (data.error || !data.projectRoot) {
          setState(null);
          return;
        }
        setState({
          forCwd: cwd,
          projectRoot: data.projectRoot,
          isGit: data.isGit ?? false,
          isTopLevel: data.isTopLevel ?? false,
          worktrees: data.worktrees ?? [],
          branches: data.branches ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) setState(null);
      });
    return () => { cancelled = true; };
  }, [cwd, refreshKey, reloadKey]);

  // 目录变了就清空并收起：上一个目录的分支列表既不能显示，也不能被点选。
  useEffect(() => {
    setState(null);
    closePanel();
  }, [cwd, closePanel]);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) closePanel();
    };
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [open, closePanel]);

  const switchTo = (branch: string | null, path: string) => {
    if (!state || state.forCwd !== cwd) return;
    requestWorktreeSwitch({ branch, path, projectRoot: state.projectRoot });
    closePanel();
  };

  const ensureCheckout = async (branchName: string, create: boolean) => {
    if (!state || state.forCwd !== cwd || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: state.projectRoot, branch: branchName, create }),
      });
      const data = await response.json().catch(() => ({})) as { path?: string; error?: string };
      if (!response.ok || data.error || !data.path) {
        setError(data.error ?? `HTTP ${response.status}`);
        return;
      }
      switchTo(branchName, data.path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleSwitchBranch = (branch: BranchEntry) => {
    if (busy) return;
    if (branch.worktreePath) {
      switchTo(branch.name, branch.worktreePath);
      return;
    }
    void ensureCheckout(branch.name, false);
  };

  const handleCreateWorktree = () => {
    const branch = newBranch.trim();
    if (!branch || busy) return;
    void ensureCheckout(branch, true);
  };

  const handleRemoveWorktree = async (path: string, force: boolean) => {
    if (!state || state.forCwd !== cwd || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/worktrees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: state.projectRoot, path, force }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; dirty?: boolean };
      if (!response.ok) {
        if (data.dirty && !force) {
          setConfirmRemove(path);
          return;
        }
        setError(data.error ?? `HTTP ${response.status}`);
        return;
      }
      setConfirmRemove(null);
      if (cwd === path) {
        const main = state.worktrees.find((worktree) => worktree.isMain);
        switchTo(main?.branch ?? null, state.projectRoot);
      } else {
        setReloadKey((key) => key + 1);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!state || state.forCwd !== cwd || !state.isGit || !state.isTopLevel) return null;

  const branches = state.branches ?? [];
  const branchesUnavailable = state.branches === null;
  const checkouts = state.worktrees;
  const orphanCheckouts = branchesUnavailable
    ? []
    : checkouts.filter((worktree) => !branches.some((branch) => branch.worktreePath === worktree.path));
  const fallbackCheckouts = branchesUnavailable ? checkouts : [];
  const showFilter = branches.length + orphanCheckouts.length + fallbackCheckouts.length >= FILTER_THRESHOLD;
  const filterText = showFilter ? filter.trim().toLowerCase() : "";
  const matchesFilter = (value: string) => !filterText || value.toLowerCase().includes(filterText);
  const visibleBranches = branches.filter(
    (branch) => matchesFilter(branch.name) || (branch.worktreePath !== null && matchesFilter(branch.worktreePath)),
  );
  const visibleOrphans = orphanCheckouts.filter((worktree) => matchesFilter(worktree.path));
  const visibleFallback = fallbackCheckouts.filter((worktree) => matchesFilter(worktree.branch ?? worktree.path));
  const noMatches = visibleBranches.length + visibleOrphans.length + visibleFallback.length === 0;
  const currentBranch = branches.find((branch) => branch.current)?.name
    ?? checkouts.find((worktree) => worktree.path === cwd)?.branch
    ?? null;
  const label = currentBranch ?? t("git.detachedHead");

  const removeButton = (path: string) => (
    <button
      type="button"
      onClick={() => void handleRemoveWorktree(path, false)}
      disabled={busy}
      title={t("git.removeCheckoutTitle", { path })}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: isMobile ? MOBILE_HIT_TARGET_PX : 34,
        height: isMobile ? MOBILE_HIT_TARGET_PX : 28,
        padding: 0, marginRight: 4,
        background: "none", border: "none",
        color: "var(--text-dim)", cursor: "pointer",
        borderRadius: 5, flexShrink: 0,
        transition: "color 0.12s, background 0.12s",
      }}
      onMouseEnter={(event) => { event.currentTarget.style.color = "#ef4444"; event.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
      onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text-dim)"; event.currentTarget.style.background = "none"; }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6M14 11v6" />
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      </svg>
    </button>
  );

  const checkoutRow = (row: {
    key: string;
    /** Checkout path; null for a branch that has none yet */
    path: string | null;
    title: string;
    checked: boolean;
    label: string;
    tag?: string;
    removable: boolean;
    confirming: boolean;
    onSelect: () => void;
  }) => {
    if (row.confirming && row.path) {
      return (
        <div
          key={row.key}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid var(--border)", background: "rgba(239,68,68,0.06)" }}
        >
          <span style={{ flex: 1, fontSize: 11, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("git.forceRemoveCheckout")}
          </span>
          <button
            type="button"
            onClick={() => void handleRemoveWorktree(row.path as string, true)}
            disabled={busy}
            style={{ padding: "3px 9px", minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined, background: "#ef4444", border: "none", borderRadius: 5, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
          >
            {t("git.force")}
          </button>
          <button
            type="button"
            onClick={() => setConfirmRemove(null)}
            style={{ padding: "3px 9px", minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined, background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", fontSize: 11, cursor: "pointer", flexShrink: 0 }}
          >
            {t("sidebar.cancel")}
          </button>
        </div>
      );
    }
    return (
      <div
        key={row.key}
        style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)" }}
      >
        <button
          type="button"
          onClick={row.onSelect}
          disabled={busy}
          title={row.title}
          style={{
            ...projectMenuRowStyle(isMobile),
            flex: 1,
            minWidth: 0,
            gap: 7,
            background: "var(--bg)",
            border: "none",
            color: row.checked ? "var(--text)" : "var(--text-muted)",
            cursor: "pointer",
            textAlign: "left",
            fontFamily: "var(--font-mono)",
          }}
        >
          {row.checked ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <polyline points="1.5 5 4 7.5 8.5 2.5" />
            </svg>
          ) : (
            <span style={{ width: 10, flexShrink: 0 }} />
          )}
          <PathLabel text={row.label} style={{ flex: 1 }} />
          {row.tag && (
            <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>{row.tag}</span>
          )}
        </button>
        {row.removable && row.path && removeButton(row.path)}
      </div>
    );
  };

  return (
    <div ref={rootRef} style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <button
        type="button"
        data-branch-switcher={currentBranch ?? "detached"}
        onClick={() => {
          if (open) closePanel();
          else setOpen(true);
        }}
        title={t("git.switchBranch")}
        aria-label={t("git.switchBranch")}
        aria-expanded={open}
        style={{
          ...projectMenuRowStyle(isMobile, 30),
          border: "none",
          borderBottom: open ? "1px solid var(--border)" : "none",
          background: open ? "var(--bg-selected)" : "transparent",
          color: "var(--text-muted)",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "var(--font-mono)",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.12s" }}>
          <polyline points="4 2.5 8 6 4 9.5" />
        </svg>
      </button>
      <AnimatedDropdown
        open={open}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            closePanel();
          }
        }}
        style={{
          position: "static",
          width: "auto",
          zIndex: 100,
          background: "var(--bg)",
          border: "none",
          borderBottom: "1px solid var(--border)",
          borderRadius: 0,
          boxShadow: "none",
          boxSizing: "border-box",
          overflow: "hidden",
        }}
      >
        {showFilter && (
          <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setFilter("");
                  closePanel();
                }
              }}
              placeholder={t("git.filterBranches")}
              autoFocus
              style={{
                width: "100%",
                minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined,
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                padding: "5px 8px",
                border: "1px solid var(--border)",
                borderRadius: 5,
                outline: "none",
                background: "var(--bg)",
                color: "var(--text)",
                boxSizing: "border-box",
              }}
            />
          </div>
        )}
        <div style={{ maxHeight: "min(40vh, 300px)", overflowY: "auto" }}>
          {visibleBranches.map((branch) => {
            const holderPath = branch.worktreePath;
            const holder = holderPath ? checkouts.find((worktree) => worktree.path === holderPath) : null;
            const isMain = holder?.isMain === true;
            const stateLabel = holderPath
              ? (isMain ? t("git.mainCheckout") : t("git.checkout"))
              : t("git.branchNoCheckout");
            return checkoutRow({
              key: branch.name,
              path: holderPath,
              title: holderPath ?? t("git.branchNoCheckoutTitle", { branch: branch.name }),
              checked: branch.current,
              label: branch.name,
              tag: stateLabel,
              removable: Boolean(holderPath) && !isMain,
              confirming: Boolean(holderPath) && confirmRemove === holderPath,
              onSelect: () => handleSwitchBranch(branch),
            });
          })}
          {visibleOrphans.map((worktree) => checkoutRow({
            key: worktree.path,
            path: worktree.path,
            title: worktree.path,
            checked: worktree.path === cwd,
            label: worktree.path,
            tag: t("git.detached"),
            removable: !worktree.isMain,
            confirming: confirmRemove === worktree.path,
            onSelect: () => switchTo(worktree.branch, worktree.path),
          }))}
          {visibleFallback.map((worktree) => checkoutRow({
            key: worktree.path,
            path: worktree.path,
            title: worktree.path,
            checked: worktree.path === cwd,
            label: worktree.branch ?? worktree.path,
            removable: !worktree.isMain,
            confirming: confirmRemove === worktree.path,
            onSelect: () => switchTo(worktree.branch, worktree.path),
          }))}
          {showFilter && noMatches && filterText.length > 0 && (
            <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-dim)" }}>{t("git.noMatchingBranches")}</div>
          )}
        </div>

        {!newOpen ? (
          <button
            type="button"
            onClick={() => {
              setNewOpen(true);
              setError(null);
              setTimeout(() => newInputRef.current?.focus(), 0);
            }}
            style={{
              ...projectMenuRowStyle(isMobile),
              gap: 7,
              padding: "8px 10px",
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" style={{ flexShrink: 0 }}>
              <line x1="5" y1="1" x2="5" y2="9" />
              <line x1="1" y1="5" x2="9" y2="5" />
            </svg>
            <span>{t("git.newWorktree")}</span>
          </button>
        ) : (
          <div style={{ padding: "6px 8px" }}>
            <input
              ref={newInputRef}
              value={newBranch}
              onChange={(event) => {
                setNewBranch(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleCreateWorktree();
                }
                if (event.key === "Escape") {
                  setNewOpen(false);
                  setNewBranch("");
                  setError(null);
                }
              }}
              placeholder={t("git.branchName")}
              style={{
                width: "100%",
                minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined,
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                padding: "5px 8px",
                border: "1px solid var(--accent)",
                borderRadius: 5,
                outline: "none",
                background: "var(--bg)",
                color: "var(--text)",
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
              <button
                type="button"
                onClick={handleCreateWorktree}
                disabled={busy || !newBranch.trim()}
                style={{
                  flex: 1,
                  padding: "4px 0",
                  minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined,
                  background: "var(--accent)",
                  border: "none",
                  borderRadius: 5,
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: busy || !newBranch.trim() ? "not-allowed" : "pointer",
                  opacity: busy || !newBranch.trim() ? 0.65 : 1,
                }}
              >
                {busy ? t("git.creating") : t("git.create")}
              </button>
              <button
                type="button"
                onClick={() => { setNewOpen(false); setNewBranch(""); setError(null); }}
                style={{
                  flex: 1,
                  padding: "4px 0",
                  minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined,
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  color: "var(--text-muted)",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                {t("sidebar.cancel")}
              </button>
            </div>
          </div>
        )}
        {error && (
          <div style={{ padding: "5px 10px 8px", color: "#dc2626", fontSize: 11, lineHeight: 1.35, overflowWrap: "anywhere" }}>
            {error}
          </div>
        )}
      </AnimatedDropdown>
    </div>
  );
}
