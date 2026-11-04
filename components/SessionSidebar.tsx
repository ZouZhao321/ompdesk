"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef, useSyncExternalStore, type CSSProperties } from "react";
import type { SessionInfo, SessionActivitySnapshot } from "@/lib/types";
import { dispatchSessionRowContextMenu } from "@/lib/session-row-context-menu";
import { restoreSessionContinuation } from "@/lib/workspace-memory";
import { summarizeWorkspaceActivity, workspaceKeyOf } from "@/lib/workspace-activity";
import type { ProjectSortMode } from "@/lib/project-order";
import {
  dedupePinnedProjects,
  normalizeProjectKey,
  orderProjectPaths,
  placeSelectedProject,
  projectDisplayName,
  togglePinnedProject,
} from "@/lib/project-order";
import { STATIC_MARKER_APPEARANCE, initialMarkerUnreadIds, resolveFinishedRuns, resolveSessionMarker, type StaticMarkerStatus } from "@/lib/session-marker";
import { addUnreadSessionIds, clearUnreadSessionIds, getServerUnreadSessionIds, getUnreadSessionIds, retainUnreadSessionIds, subscribeUnreadSessionIds } from "@/lib/session-unread";
import { sessionDisplayTitle } from "@/lib/session-title";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MOBILE_HIT_TARGET_PX } from "@/lib/mobile-layout";
import { AnimatedDropdown } from "./AnimatedDropdown";
import { DirectoryPicker } from "./DirectoryPicker";
import { OmpWordmark } from "./OmpWordmark";
import { ProjectPinMenuItem } from "./ProjectPinMenuItem";
import { ProjectRow, type ProjectActivity } from "./ProjectRow";
import { ProjectSortControl } from "./ProjectSortControl";
import { projectMenuRowStyle } from "./project-menu-row-style";

interface Props {
  selectedSessionId: string | null;
  selectedRuntimeId?: string;
  optimisticSession?: SessionInfo | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
  initialSessionId?: string | null;
  skipInitialProjectSelection?: boolean;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  selectedCwd?: string | null;
  onCwdChange?: (cwd: string | null, projectRoot?: string | null) => void;
  /** Fired when a session that is not currently selected finishes running.
   *  Lets the app play a cross-workspace completion tone. */
  onBackgroundTaskDone?: () => void;
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
}

interface BranchEntry {
  name: string;
  /** Path of the checkout holding this branch, null when none does */
  worktreePath: string | null;
  current: boolean;
}

interface WorktreeState {
  /** The cwd this data was fetched for — guards against stale responses */
  forCwd: string;
  projectRoot: string;
  isGit: boolean;
  /** False when forCwd is a repo subdirectory — the switcher is hidden there
   *  because subdir sessions keep their own project identity */
  isTopLevel: boolean;
  worktrees: WorktreeEntry[];
  /** null when enumeration failed; an empty array means the repo has no branches */
  branches: BranchEntry[] | null;
}

/** 会话活动快照的客户端形态；字段可选是因为首次渲染时还没有拿到任何数据。 */
type SessionActivitySnapshotState = { [K in keyof SessionActivitySnapshot]?: SessionActivitySnapshot[K] };

/** 会话列表接口的响应：会话数组加上同一份活动快照。 */
type SessionsResponse = SessionActivitySnapshotState & { sessions: SessionInfo[] };

const MARKER_SEEDED_STORAGE_KEY = "ompdesk:session-marker-seeded";
const RUNNING_SESSIONS_STORAGE_KEY = "ompdesk:running-session-ids";
const RUNNING_SESSIONS_POLL_MS = 2500;
const PROJECT_SESSION_LIMIT = 5;
const COLLAPSED_PROJECTS_STORAGE_KEY = "ompdesk:collapsed-projects";
const REMOVED_PROJECTS_STORAGE_KEY = "ompdesk:removed-projects";
const PROJECT_SORT_STORAGE_KEY = "ompdesk:project-sort";
const PINNED_PROJECTS_STORAGE_KEY = "ompdesk:pinned-projects";

function loadRemovedProjects(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(REMOVED_PROJECTS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? new Set(parsed.filter((project): project is string => typeof project === "string").map(normalizeProjectKey))
      : new Set();
  } catch {
    return new Set();
  }
}

function saveRemovedProjects(projects: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (projects.size === 0) window.localStorage.removeItem(REMOVED_PROJECTS_STORAGE_KEY);
    else window.localStorage.setItem(REMOVED_PROJECTS_STORAGE_KEY, JSON.stringify([...projects]));
  } catch {
    // Ignore storage quota and privacy-mode errors.
  }
}

/** 本浏览器是否还没做过「异常存量加入未读」的一次性播种。 */
function shouldSeedInitialMarkerUnread(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MARKER_SEEDED_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

function markInitialMarkerUnreadSeeded(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MARKER_SEEDED_STORAGE_KEY, "1");
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

/** 上次页面看到的运行会话；服务退出后用于判断哪些会话随进程一起结束。 */
function loadPersistedRunningSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(RUNNING_SESSIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? new Set(parsed.filter((id): id is string => typeof id === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function savePersistedRunningSessionIds(ids: ReadonlySet<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0) window.localStorage.removeItem(RUNNING_SESSIONS_STORAGE_KEY);
    else window.localStorage.setItem(RUNNING_SESSIONS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}
function loadCollapsedProjects(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSED_PROJECTS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? new Set(parsed.filter((path): path is string => typeof path === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function saveCollapsedProjects(projects: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (projects.size === 0) window.localStorage.removeItem(COLLAPSED_PROJECTS_STORAGE_KEY);
    else window.localStorage.setItem(COLLAPSED_PROJECTS_STORAGE_KEY, JSON.stringify([...projects]));
  } catch {
    // Ignore storage quota and privacy-mode errors.
  }
}

function loadProjectSortMode(): ProjectSortMode {
  if (typeof window === "undefined") return "time";
  try {
    return window.localStorage.getItem(PROJECT_SORT_STORAGE_KEY) === "name" ? "name" : "time";
  } catch {
    return "time";
  }
}

function saveProjectSortMode(mode: ProjectSortMode): void {
  if (typeof window === "undefined") return;
  try {
    if (mode === "time") window.localStorage.removeItem(PROJECT_SORT_STORAGE_KEY);
    else window.localStorage.setItem(PROJECT_SORT_STORAGE_KEY, "name");
  } catch {
    // Ignore storage quota and privacy-mode errors.
  }
}

/** 置顶序列按点击置顶的先后排列；存储里缺失或损坏时按未置顶处理。 */
function loadPinnedProjects(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PINNED_PROJECTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return dedupePinnedProjects(parsed.filter((project): project is string => typeof project === "string"));
  } catch {
    return [];
  }
}

function savePinnedProjects(projects: readonly string[]): void {
  if (typeof window === "undefined") return;
  try {
    if (projects.length === 0) window.localStorage.removeItem(PINNED_PROJECTS_STORAGE_KEY);
    else window.localStorage.setItem(PINNED_PROJECTS_STORAGE_KEY, JSON.stringify(projects));
  } catch {
    // Ignore storage quota and privacy-mode errors.
  }
}



/**
 * Return all projects (deduped by projectRoot so worktrees collapse into their
 * main repo) sorted by most recent session activity.
 */
function getRecentProjects(sessions: SessionInfo[]): string[] {
  const latestByRoot = new Map<string, string>(); // workspace key -> most recent modified
  for (const s of sessions) {
    const root = workspaceKeyOf(s);
    if (!root) continue;
    const prev = latestByRoot.get(root);
    if (!prev || s.modified > prev) {
      latestByRoot.set(root, s.modified);
    }
  }
  return [...latestByRoot.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .map(([root]) => root);
}


/**
 * Path label that ellipsizes on the LEFT, keeping the (most relevant) trailing
 * segments visible: "…orkspace/ompdesk". Shows as much of the path as fits
 * instead of a fixed number of segments. The rtl container moves the ellipsis
 * to the left edge; the inner plaintext bidi isolation keeps the path itself
 * rendered strictly left-to-right (no punctuation reordering).
 */
function PathLabel({ text, style }: { text: string; style?: CSSProperties }) {
  return (
    <span
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        display: "block",
        minWidth: 0,
        lineHeight: 1.35,
        direction: "rtl",
        textAlign: "left",
        ...style,
      }}
    >
      <span style={{ unicodeBidi: "plaintext" }}>{text}</span>
    </span>
  );
}

interface SessionTreeNode {
  session: SessionInfo;
  children: SessionTreeNode[];
}

function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
  const byId = new Map<string, SessionTreeNode>();
  for (const s of sessions) {
    byId.set(s.id, { session: s, children: [] });
  }

  // Build a map of parentSessionId chains so we can resolve missing ancestors
  const parentOf = new Map<string, string>();
  for (const s of sessions) {
    if (s.parentSessionId) parentOf.set(s.id, s.parentSessionId);
  }

  // Walk up the parentSessionId chain to find the nearest ancestor that exists in byId
  function resolveAncestor(id: string): string | null {
    let cur = parentOf.get(id);
    const visited = new Set<string>();
    while (cur) {
      if (visited.has(cur)) return null; // cycle guard
      visited.add(cur);
      if (byId.has(cur)) return cur;
      cur = parentOf.get(cur);
    }
    return null;
  }

  const roots: SessionTreeNode[] = [];
  for (const node of byId.values()) {
    const ancestor = resolveAncestor(node.session.id);
    if (ancestor) {
      byId.get(ancestor)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort each level by modified desc
  const sort = (nodes: SessionTreeNode[]) => {
    nodes.sort((a, b) => b.session.modified.localeCompare(a.session.modified));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

function useScramble(target: string, running: boolean): string {
  const [display, setDisplay] = useState(target);
  const frameRef = useRef<number | null>(null);
  const iterRef = useRef(0);

  useEffect(() => {
    if (!running) {
      setDisplay(target);
      return;
    }
    iterRef.current = 0;
    const totalFrames = target.length * 4;

    const step = () => {
      iterRef.current += 1;
      const progress = iterRef.current / totalFrames;
      const resolved = Math.floor(progress * target.length);

      setDisplay(
        target
          .split("")
          .map((char, i) => {
            if (char === " ") return " ";
            if (i < resolved) return char;
            return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
          })
          .join("")
      );

      if (iterRef.current < totalFrames) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(target);
      }
    };

    frameRef.current = requestAnimationFrame(step);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [target, running]);

  return display;
}

function PiWebTitle() {
  const [showVersion, setShowVersion] = useState(false);
  const [scrambling, setScrambling] = useState(false);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const target = showVersion ? `${process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}/${process.env.NEXT_PUBLIC_OMP_VERSION ?? "0.0.0"}` : "ompdesk";
  const display = useScramble(target, scrambling);

  const triggerScramble = useCallback((toVersion: boolean) => {
    setShowVersion(toVersion);
    setScrambling(true);
    setTimeout(() => setScrambling(false), (toVersion ? 6 : 8) * 4 * (1000 / 60) + 100);
  }, []);

  const handleClick = useCallback(() => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);

    const next = !showVersion;
    triggerScramble(next);

    if (next) {
      revertTimerRef.current = setTimeout(() => triggerScramble(false), 3000);
    }
  }, [showVersion, triggerScramble]);

  useEffect(() => () => { if (revertTimerRef.current) clearTimeout(revertTimerRef.current); }, []);

  return (
    <button
      className="sidebar-brand-button"
      onClick={handleClick}
      style={{
        display: "flex",
        alignItems: "center",
        background: "none",
        border: "none",
        padding: 0,
        cursor: "default",
        color: showVersion ? "var(--accent)" : "var(--text)",
        minWidth: "6ch",
      }}
    >
      <OmpWordmark
        label={display}
        labelStyle={showVersion ? { fontFamily: "var(--font-mono)", letterSpacing: "-0.01em" } : undefined}
      />
    </button>
  );
}

export function SessionSidebar({ selectedSessionId, selectedRuntimeId, optimisticSession, onSelectSession, onNewSession, initialSessionId, skipInitialProjectSelection, onInitialRestoreDone, refreshKey, onSessionDeleted, selectedCwd: selectedCwdProp, onCwdChange, onBackgroundTaskDone }: Props) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const sessionsForDisplay = optimisticSession && !allSessions.some((session) => session.id === optimisticSession.id)
    ? [optimisticSession, ...allSessions]
    : allSessions;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set());
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set());
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState<string | null>(null);
  const [projectSortMode, setProjectSortMode] = useState<ProjectSortMode>("time");
  const [pinnedProjects, setPinnedProjects] = useState<string[]>([]);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [removeProjectConfirm, setRemoveProjectConfirm] = useState<{ project: string; count: number } | null>(null);
  const [removedProjects, setRemovedProjects] = useState<Set<string>>(() => new Set());
  const [wtFilter, setWtFilter] = useState("");
  const [customPathOpen, setCustomPathOpen] = useState(false);
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  // Worktree switcher state
  const [worktreeState, setWorktreeState] = useState<WorktreeState | null>(null);
  const [wtDropdownOpen, setWtDropdownOpen] = useState(false);
  const [wtNewOpen, setWtNewOpen] = useState(false);
  const [wtNewBranch, setWtNewBranch] = useState("");
  const [wtError, setWtError] = useState<string | null>(null);
  const [wtBusy, setWtBusy] = useState(false);
  const [wtConfirmRemove, setWtConfirmRemove] = useState<string | null>(null);
  const wtDropdownRef = useRef<HTMLDivElement>(null);
  const wtNewInputRef = useRef<HTMLInputElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const [sessionRefreshDone, setSessionRefreshDone] = useState(false);
  // 绿色完成提示点亮后自灭；计时器归 effect 管，卸载时清掉。
  useEffect(() => {
    if (!sessionRefreshDone) return;
    const timer = setTimeout(() => setSessionRefreshDone(false), 2000);
    return () => clearTimeout(timer);
  }, [sessionRefreshDone]);
  const [activitySnapshot, setActivitySnapshot] = useState<SessionActivitySnapshotState>({});
  const runningSessionIds = useMemo(() => new Set(activitySnapshot.runningSessionIds ?? []), [activitySnapshot]);
  // 运行中但停在提问表单上、等待用户作答的会话。
  const waitingSessionIds = useMemo(() => new Set(activitySnapshot.waitingSessionIds ?? []), [activitySnapshot]);
  // 未读集合与打开路径共用同一份状态：这里只订阅，写入由 add/clear 完成。
  const unreadSessionIds = useSyncExternalStore(
    subscribeUnreadSessionIds,
    getUnreadSessionIds,
    getServerUnreadSessionIds,
  );
  const previousActivitySnapshotRef = useRef(activitySnapshot);
  // 页面在相邻两份快照之间是否一直可见；隐藏期间结束的运行要亮标记。
  const pageVisibilitySinceSnapshotRef = useRef<DocumentVisibilityState>(
    typeof document === "undefined" ? "visible" : document.visibilityState,
  );
  // 相邻两份快照之间是否与服务失去过联系；服务失联时结束时刻不可观察。
  const serverOutageSinceSnapshotRef = useRef(false);
  // 首轮轮询是否已经到达；服务失联的对账只认轮询快照，不认会话列表的初始回退。
  const [activityPolled, setActivityPolled] = useState(false);
  const startupRunningIdsRef = useRef<Set<string> | null>(null);
  const restartReconciledRef = useRef(false);
  // 初始恢复是否已经有机会选定会话；播种必须排在它之后。
  const [initialRestoreSettled, setInitialRestoreSettled] = useState(!initialSessionId);
  // 启动时打开的那个会话（含 continuation 映射后的 id）：它一进来就是可见的
  // 当前会话，播种不能把它点亮，恢复落定后也要清掉旧的未读标记。
  const launchSessionIdRef = useRef<string | null>(initialSessionId);
  const listedRuntimeIdsRef = useRef<Record<string, string>>({});
  // Once polling has delivered a snapshot it is the source of truth for
  // running state; late /api/sessions responses must not overwrite it.
  const runningPollAuthoritativeRef = useRef(false);
  useEffect(() => {
    setCollapsedProjects(loadCollapsedProjects());
    setRemovedProjects(loadRemovedProjects());
    setProjectSortMode(loadProjectSortMode());
    setPinnedProjects(loadPinnedProjects());
  }, []);


  const loadSessions = useCallback(async (showLoading = false, force = false) => {
    try {
      if (showLoading) setLoading(true);
      const res = await fetch(force ? "/api/sessions?force=1" : "/api/sessions", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as SessionsResponse;
      listedRuntimeIdsRef.current = data.sessionIdsByRuntimeId ?? {};
      setAllSessions(data.sessions);
      // Treat the fetched running set as an initial fallback only. Once the
      // lightweight poll is live, a slow session-list fetch cannot overwrite it.
      if (!runningPollAuthoritativeRef.current) {
        setActivitySnapshot({
          runningSessionIds: data.runningSessionIds,
          waitingSessionIds: data.waitingSessionIds,
          sessionIdsByRuntimeId: data.sessionIdsByRuntimeId,
        });
      }
      // Drop unread markers for sessions that no longer exist (e.g. deleted).
      retainUnreadSessionIds(new Set(data.sessions.map((s) => s.id)));
      setError(null);
      // 绿色完成提示只属于绕过缓存的扫描；后台读取不点亮刷新按钮。
      if (force) setSessionRefreshDone(true);
    } catch (e) {
      setError(String(e));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  // Bumped whenever a session is archived/restored so the Archived section
  // refetches; the main list simply reloads (archived rows are now hidden).
  const [archiveRefreshKey, setArchiveRefreshKey] = useState(0);
  const handleSessionArchived = useCallback(() => {
    setArchiveRefreshKey((k) => k + 1);
    loadSessions();
  }, [loadSessions]);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    loadSessions(isFirst, !isFirst);
  }, [loadSessions, refreshKey]);

  // 首次加载时把浏览器的异常存量加入未读集合。播种只做一次：之后点开会话
  // 得到的已读结果不会被页面刷新重新点亮，清掉本机存储才会重新播种。
  // 播种排在初始恢复之后：恢复在首次加载时同步选定会话，早播种会把正在恢复
  // 的会话播成未读。当前打开且可见的会话按已读处理（看到即灭）。
  useEffect(() => {
    if (!initialRestoreSettled) return;
    if (allSessions.length === 0 || !shouldSeedInitialMarkerUnread()) return;
    markInitialMarkerUnreadSeeded();
    const seededIds = initialMarkerUnreadIds(allSessions, runningSessionIds, waitingSessionIds)
      .filter((id) => id !== selectedSessionId && id !== launchSessionIdRef.current);
    addUnreadSessionIds(seededIds);
  }, [allSessions, runningSessionIds, waitingSessionIds, selectedSessionId, initialRestoreSettled]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const schedule = () => {
      clearTimer();
      if (stopped || document.visibilityState !== "visible") return;
      timer = setTimeout(() => void poll(), RUNNING_SESSIONS_POLL_MS);
    };

    // 只有上一份快照里还有运行中的会话时才算与服务失联，否则没有结束归属要改。
    const markServerOutage = () => {
      if ((previousActivitySnapshotRef.current.runningSessionIds?.length ?? 0) > 0) {
        serverOutageSinceSnapshotRef.current = true;
      }
    };

    const poll = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const current = new AbortController();
      controller?.abort();
      controller = current;
      try {
        const res = await fetch("/api/agent/running", {
          cache: "no-store",
          signal: current.signal,
        });
        if (!res.ok) {
          markServerOutage();
          return;
        }
        const data = await res.json() as SessionActivitySnapshotState;
        if (stopped || controller !== current) return;
        runningPollAuthoritativeRef.current = true;
        setActivityPolled(true);
        setActivitySnapshot({
          runningSessionIds: data.runningSessionIds,
          waitingSessionIds: data.waitingSessionIds,
          sessionIdsByRuntimeId: data.sessionIdsByRuntimeId,
        });
      } catch {
        // Keep the last known state; the next visible-tab poll retries.
        markServerOutage();
      } finally {
        if (controller === current) controller = null;
        schedule();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // 回到前台时同时核对运行快照与会话最后状态，标记才有正确的依据。
        void poll();
        // 只有隐藏期间确有运行在跑或与服务失联过，才需要绕过缓存重扫：
        // 其余情况轻量读取列表即可，避免每次切回前台都全量扫描。
        const mayHaveFinished =
          serverOutageSinceSnapshotRef.current
          || (previousActivitySnapshotRef.current.runningSessionIds?.length ?? 0) > 0;
        loadSessions(false, mayHaveFinished);
        return;
      }
      pageVisibilitySinceSnapshotRef.current = "hidden";
      clearTimer();
      controller?.abort();
      controller = null;
    };

    void poll();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      clearTimer();
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadSessions]);

  useEffect(() => {
    const previousSnapshot = previousActivitySnapshotRef.current;
    const previous = new Set(previousSnapshot.runningSessionIds ?? []);
    // 结束归属看这份快照覆盖的时间段：期间隐藏过或与服务失联，结束就不算被看到。
    const finished = resolveFinishedRuns({
      previousRunningSessionIds: previousSnapshot.runningSessionIds ?? [],
      runningSessionIds,
      previousSessionIdsByRuntimeId: previousSnapshot.sessionIdsByRuntimeId,
      sessionIdsByRuntimeId: activitySnapshot.sessionIdsByRuntimeId,
      selectedSessionId,
      selectedRuntimeId,
      isPageVisible: pageVisibilitySinceSnapshotRef.current === "visible",
      isEndUnobserved: serverOutageSinceSnapshotRef.current,
    });
    const newlyRunning = [...runningSessionIds].filter((id) => !previous.has(id));

    // 再次进入运行的会话先清掉旧标记，结束后按新结果重新亮。
    clearUnreadSessionIds(runningSessionIds);
    addUnreadSessionIds(finished.unreadIds);
    // 隐藏期间结束的选中会话，回到前台时正看着它：看到即已读，不留标记。
    if (
      document.visibilityState === "visible"
      && selectedSessionId
      && finished.finishedIds.includes(selectedSessionId)
    ) {
      clearUnreadSessionIds([selectedSessionId]);
    }
    const hasUnlistedRunningSession = newlyRunning.some(
      (id) => !allSessions.some((session) => session.id === id),
    );
    // 只有确实产生了未读结果才重读最后状态：选中会话每轮结束都已读，不必全量刷新。
    if (finished.unreadIds.length > 0 || hasUnlistedRunningSession) {
      loadSessions(false, true);
    }
    if (finished.backgroundIds.length > 0) {
      onBackgroundTaskDone?.();
    }

    // 只有新快照才移动对比窗口；会话列表刷新等无关重跑不能把窗口提前关掉。
    const hasNewSnapshot = previousSnapshot !== activitySnapshot;
    if (hasNewSnapshot) {
      previousActivitySnapshotRef.current = activitySnapshot;
      pageVisibilitySinceSnapshotRef.current = document.visibilityState;
      serverOutageSinceSnapshotRef.current = false;
    }
  }, [activitySnapshot, runningSessionIds, selectedSessionId, selectedRuntimeId, allSessions, loadSessions, onBackgroundTaskDone]);

  // 服务失联或退出后页面看不到结束的那一刻，也无法区分哪次运行是被打断的。把上次
  // 页面看到过的运行集合与首轮轮询对比：消失的运行一律记为未读，之后持续记录当前集合。
  useEffect(() => {
    // 恢复中的会话尚未成为选中会话，对账必须等初始恢复尘埃落定，否则会把它点亮。
    if (!activityPolled || !initialRestoreSettled) return;
    if (startupRunningIdsRef.current === null) {
      startupRunningIdsRef.current = loadPersistedRunningSessionIds();
    }
    if (!restartReconciledRef.current) {
      restartReconciledRef.current = true;
      const lostAcrossRestart = resolveFinishedRuns({
        previousRunningSessionIds: [...startupRunningIdsRef.current],
        runningSessionIds,
        isPageVisible: true,
        isEndUnobserved: true,
      });
      // 与播种规则一致：正在打开的会话（自动恢复）看到即已读，不记未读。
      addUnreadSessionIds(lostAcrossRestart.unreadIds.filter((id) => id !== selectedSessionId));
    }
    savePersistedRunningSessionIds(runningSessionIds);
  }, [activityPolled, initialRestoreSettled, runningSessionIds, selectedSessionId]);

  const restoredRef = useRef(false);

  /** Resolve the project root for a cwd from the freshest data available */
  const projectRootFor = useCallback((cwd: string | null): string | null => {
    if (!cwd) return null;
    if (worktreeState && worktreeState.forCwd === cwd) return worktreeState.projectRoot;
    // Any path in the loaded worktree list belongs to that project — covers
    // worktrees without sessions, so switching to them keeps the row mounted.
    if (worktreeState?.worktrees.some((w) => w.path === cwd)) return worktreeState.projectRoot;
    const match = sessionsForDisplay.find((s) => s.cwd === cwd);
    return match?.projectRoot ?? cwd;
  }, [worktreeState, sessionsForDisplay]);

  // Notify parent only when the effective cwd actually changes (not when
  // projectRootFor identity changes due to session/worktree refreshes).
  const lastNotifiedCwdRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastNotifiedCwdRef.current === selectedCwd) return;
    lastNotifiedCwdRef.current = selectedCwd;
    onCwdChange?.(selectedCwd, projectRootFor(selectedCwd));
  }, [selectedCwd, onCwdChange, projectRootFor]);

  // Sync the worktree switcher to the selected session's cwd. Sessions of all
  // worktrees in a project share one list, so clicking a session from another
  // worktree should move the effective cwd there. Only fires when the prop
  // value changes, so a manual switcher change is not snapped back.
  const lastSyncedCwdPropRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedCwdProp && selectedCwdProp !== lastSyncedCwdPropRef.current) {
      lastSyncedCwdPropRef.current = selectedCwdProp;
      setSelectedCwd(selectedCwdProp);
    }
  }, [selectedCwdProp]);

  // Load worktrees for the current effective cwd
  const [wtRefreshKey, setWtRefreshKey] = useState(0);
  useLayoutEffect(() => {
    if (!selectedCwd) {
      setWorktreeState(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/worktrees?cwd=${encodeURIComponent(selectedCwd)}`)
      .then((r) => r.json())
      .then((d: { projectRoot?: string; isGit?: boolean; isTopLevel?: boolean; worktrees?: WorktreeEntry[]; branches?: BranchEntry[] | null; error?: string }) => {
        if (cancelled) return;
        if (d.error || !d.projectRoot) {
          setWorktreeState(null);
          return;
        }
        setWorktreeState({
          forCwd: selectedCwd,
          projectRoot: d.projectRoot,
          isGit: d.isGit ?? false,
          isTopLevel: d.isTopLevel ?? false,
          worktrees: d.worktrees ?? [],
          branches: d.branches ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setWorktreeState(null);
        }
      });
    return () => { cancelled = true; };
  }, [selectedCwd, wtRefreshKey, refreshKey]);

  // Auto-select cwd and restore session from URL on first load
  useEffect(() => {
    if (skipInitialProjectSelection) {
      // cwd 由 URL 接管，侧栏不做恢复，播种不必再等。URL 里的那个会话由父组件
      // 打开，同样是启动后立刻可见的会话，旧的未读标记在这里一并清掉。URL 可能
      // 带 continuation handle（runtime id），先换算成当前会话 id 再清。
      if (initialSessionId) {
        const target = restoreSessionContinuation(
          initialSessionId,
          allSessions,
          listedRuntimeIdsRef.current,
        );
        clearUnreadSessionIds([target?.id ?? initialSessionId]);
      }
      setInitialRestoreSettled(true);
      return;
    }
    // 列表还在加载时为空只代表尚未到达，不能据此判定恢复结果。
    if (loading) return;
    if (allSessions.length === 0) {
      // 列表就绪但为空：恢复目标不存在，播种、重启对账与运行集合持久化都不能
      // 等一次永远不会到来的恢复。父组件也在这里收到通知，把占位画出来。
      setInitialRestoreSettled(true);
      onInitialRestoreDone?.();
      return;
    }

    if (selectedCwd === null) {
      // If restoring a session, set cwd to match that session
      if (initialSessionId && !restoredRef.current) {
        restoredRef.current = true;
        const target = restoreSessionContinuation(initialSessionId, allSessions, listedRuntimeIdsRef.current);
        // 恢复目标已经确定，播种从这里开始，并按本次选中的会话过滤。
        setInitialRestoreSettled(true);
        if (target) {
          setSelectedCwd(target.cwd);
          // 父组件的自动恢复（isRestore）不清未读，而恢复出来的会话就是启动后
          // 立刻可见的当前会话：这里清掉它的标记，播种也不会再把它点亮。
          launchSessionIdRef.current = target.id;
          clearUnreadSessionIds([target.id]);
          onSelectSession(target, true);
          return;
        }
        // Session not found — notify parent so it can show the placeholder
        onInitialRestoreDone?.();
      }
      const projects = getRecentProjects(allSessions)
        .filter((project) => !removedProjects.has(normalizeProjectKey(project)));
      if (projects.length > 0) setSelectedCwd(projects[0]);
    }
  }, [allSessions, loading, selectedCwd, initialSessionId, skipInitialProjectSelection, onSelectSession, onInitialRestoreDone, removedProjects]);

  const commitCustomPath = useCallback(async (candidate: string) => {
    const path = candidate.trim();
    if (!path || customPathValidating) return;

    setCustomPathValidating(true);
    setCustomPathError(null);
    try {
      const res = await fetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      const data = await res.json().catch(() => ({})) as { cwd?: string; error?: string };
      if (!res.ok || data.error) {
        setCustomPathError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const selectedPath = data.cwd ?? path;
      setRemovedProjects((current) => {
        const key = normalizeProjectKey(selectedPath);
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        saveRemovedProjects(next);
        return next;
      });
      setSelectedCwd(selectedPath);
      setCustomPathOpen(false);
    } catch (error) {
      setCustomPathError(error instanceof Error ? error.message : String(error));
    } finally {
      setCustomPathValidating(false);
    }
  }, [customPathValidating]);

  const handleCustomPathClick = useCallback(() => {
    setCustomPathOpen(true);
    setCustomPathError(null);
  }, []);

  // Optimistically register the checkout so projectRootFor() resolves it to
  // the main repo before the refetch lands (keeps AppShell from treating the
  // new cwd as a different project), then switch to it.
  const applyCheckout = useCallback((branchName: string, path: string) => {
    setWorktreeState((prev) => {
      if (!prev) return prev;
      const worktrees = prev.worktrees.some((wt) => wt.path === path)
        ? prev.worktrees
        : [...prev.worktrees, { path, branch: branchName, isMain: false }];
      // The branch list is unknown after a failed enumeration; the refetch below
      // fills it in, so only the checkout side is updated here.
      if (!prev.branches) return { ...prev, forCwd: path, worktrees };
      const known = prev.branches.some((branch) => branch.name === branchName);
      const updated = prev.branches.map((branch) => ({
          ...branch,
          worktreePath: branch.name === branchName ? path : branch.worktreePath,
          current: branch.name === branchName,
      }));
      const branches = known ? updated : [...updated, { name: branchName, worktreePath: path, current: true }];
      return { ...prev, forCwd: path, worktrees, branches };
    });
    setSelectedCwd(path);
    setWtRefreshKey((k) => k + 1);
  }, []);

  // One teardown for every successful switch or create: a leftover filter or a
  // pending force-remove prompt must not outlive the panel.
  const closeWtPanel = useCallback(() => {
    setWtDropdownOpen(false);
    setWtNewOpen(false);
    setWtNewBranch("");
    setWtError(null);
    setWtFilter("");
    setWtConfirmRemove(null);
  }, []);

  const handleCreateWorktree = useCallback(async () => {
    const branch = wtNewBranch.trim();
    if (!branch || wtBusy || !worktreeState) return;
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await fetch("/api/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: worktreeState.projectRoot, branch, create: true }),
      });
      const data = await res.json().catch(() => ({})) as { path?: string; error?: string };
      if (!res.ok || data.error || !data.path) {
        setWtError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      closeWtPanel();
      applyCheckout(branch, data.path);
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
    } finally {
      setWtBusy(false);
    }
  }, [wtNewBranch, wtBusy, worktreeState, applyCheckout, closeWtPanel]);

  // Selecting a branch: reuse its checkout when one exists, otherwise create
  // one through the same endpoint and switch to the result.
  const handleSwitchBranch = useCallback(async (branch: BranchEntry) => {
    if (!worktreeState || wtBusy) return;
    if (branch.worktreePath) {
      setSelectedCwd(branch.worktreePath);
      closeWtPanel();
      return;
    }
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await fetch("/api/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: worktreeState.projectRoot, branch: branch.name }),
      });
      const data = await res.json().catch(() => ({})) as { path?: string; reused?: boolean; error?: string };
      if (!res.ok || data.error || !data.path) {
        setWtError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const path = data.path;
      applyCheckout(branch.name, path);
      closeWtPanel();
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
    } finally {
      setWtBusy(false);
    }
  }, [worktreeState, wtBusy, applyCheckout, closeWtPanel]);

  const handleRemoveWorktree = useCallback(async (path: string, force: boolean) => {
    if (!worktreeState || wtBusy) return;
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await fetch("/api/worktrees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: worktreeState.projectRoot, path, force }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; dirty?: boolean };
      if (!res.ok) {
        if (data.dirty && !force) {
          // Dirty worktree — ask the user to confirm a force removal
          setWtConfirmRemove(path);
          return;
        }
        setWtError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setWtConfirmRemove(null);
      if (selectedCwd === path) setSelectedCwd(worktreeState.projectRoot);
      setWtRefreshKey((k) => k + 1);
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
    } finally {
      setWtBusy(false);
    }
  }, [worktreeState, wtBusy, selectedCwd]);

  // 收起项目菜单及其派生的确认条 / 工作树弹层状态；hover 高亮由调用方决定。
  const dismissProjectMenu = useCallback(() => {
    setProjectMenuOpen(null);
    setRemoveProjectConfirm(null);
    closeWtPanel();
  }, [closeWtPanel]);

  // Close the project actions menu on outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wtDropdownRef.current && !wtDropdownRef.current.contains(e.target as Node)) {
        dismissProjectMenu();
        setHoveredProject(null);
      }
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setSortMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dismissProjectMenu]);

  // Clicking a session moves the effective cwd to that session's worktree.
  // Done on the click path (not via the selectedCwd prop sync) so it also
  // works when the prop value won't change — e.g. re-clicking the already
  // open session after manually switching worktrees.
  const handleSelectSessionFromList = useCallback((s: SessionInfo) => {
    if (s.cwd) setSelectedCwd(s.cwd);
    onSelectSession(s);
  }, [onSelectSession]);

  const handleNewSession = useCallback((project = selectedCwd) => {
    if (!project) return;
    // Generate a temporary UUID client-side — no backend call needed.
    // Pi will be spawned lazily when the user sends the first message.
    const tempId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    setSelectedCwd(project);
    onNewSession?.(tempId, project);
  }, [selectedCwd, onNewSession]);

  const toggleProjectCollapsed = useCallback((project: string) => {
    setCollapsedProjects((current) => {
      const next = new Set(current);
      if (next.has(project)) next.delete(project);
      else next.add(project);
      saveCollapsedProjects(next);
      return next;
    });
  }, []);

  const chooseProjectSortMode = useCallback((mode: ProjectSortMode) => {
    setProjectSortMode(mode);
    saveProjectSortMode(mode);
    setSortMenuOpen(false);
  }, []);

  const closeProjectSortMenu = useCallback(() => setSortMenuOpen(false), []);

  // 切换置顶后菜单立即收起，行高亮也随之清掉，避免菜单悬在移动过的项目上。
  const handleTogglePinnedProject = useCallback((project: string) => {
    const next = togglePinnedProject(pinnedProjects, project);
    setPinnedProjects(next);
    savePinnedProjects(next);
    dismissProjectMenu();
    setHoveredProject(null);
  }, [pinnedProjects, dismissProjectMenu]);

  const selectedProject = projectRootFor(selectedCwd);
  // 选中判定与 placeSelectedProject 的去重必须用同一套比较键：Windows 下同一路径的
  // 盘符大小写或分隔符写法不同，原样比较会既插不进去也高亮不到。
  const selectedProjectKey = selectedProject ? normalizeProjectKey(selectedProject) : null;
  const recentProjectPaths = getRecentProjects(sessionsForDisplay)
    .filter((project) => !removedProjects.has(normalizeProjectKey(project)));
  const orderedProjectPaths = orderProjectPaths(recentProjectPaths, projectSortMode, pinnedProjects);
  const pinnedProjectKeys = new Set(pinnedProjects.map(normalizeProjectKey));
  // 当前选中但还没有会话的项目也要出现在列表里：已置顶的按置顶位次落位，
  // 其余排在全部置顶项之后、其他未置顶项目之前。
  const projectPaths = selectedProject && !removedProjects.has(normalizeProjectKey(selectedProject))
    ? placeSelectedProject(orderedProjectPaths, selectedProject, pinnedProjects)
    : orderedProjectPaths;
  // 每个工作区的 active / waiting / busy 计数一次遍历算出。等待集合与运行集合
  // 来源独立，所以「正在干活」必须用集合差、「移除前确认」必须用并集，
  // 不能从运行总数里直接减等待数。
  const workspaceActivity = useMemo(
    () => summarizeWorkspaceActivity(sessionsForDisplay, runningSessionIds, waitingSessionIds),
    [sessionsForDisplay, runningSessionIds, waitingSessionIds],
  );

  // 每个工作区的活动计数，键走共用的工作区键规则。`running` 只数正在干活的
  // 会话（等待回答单列）。未读会话按会话行同一个静态标记分组，所以项目行的
  // 汇总与行内的灯在状态与颜色上始终一致。
  const projectActivity = useMemo(() => {
    const counts = new Map<string, ProjectActivity>();
    for (const session of sessionsForDisplay) {
      const key = workspaceKeyOf(session);
      if (!key) continue;
      let entry = counts.get(key);
      if (!entry) {
        entry = {
          running: workspaceActivity.get(key)?.active ?? 0,
          waiting: workspaceActivity.get(key)?.waiting ?? 0,
          unread: {},
        };
        counts.set(key, entry);
      }
      const marker = resolveSessionMarker({
        status: session.status,
        isRunning: runningSessionIds.has(session.id),
        isWaiting: waitingSessionIds.has(session.id),
        isUnread: unreadSessionIds.has(session.id),
      });
      if (marker?.kind === "static") {
        entry.unread[marker.status] = (entry.unread[marker.status] ?? 0) + 1;
      }
    }
    return counts;
  }, [sessionsForDisplay, workspaceActivity, unreadSessionIds, runningSessionIds, waitingSessionIds]);

  const executeRemoveProject = (project: string) => {
    const key = normalizeProjectKey(project);
    setRemovedProjects((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      saveRemovedProjects(next);
      return next;
    });
    dismissProjectMenu();
    if (selectedProject && normalizeProjectKey(selectedProject) === key) {
      setSelectedCwd(null);
    }
  };

  // 移除前先看活动快照：还有会话在运行或等待回答就只弹确认条，不改变任何状态。
  const requestRemoveProject = (project: string) => {
    const count = workspaceActivity.get(project)?.busy ?? 0;
    if (count > 0) {
      setRemoveProjectConfirm({ project, count });
      return;
    }
    executeRemoveProject(project);
  };

  const sessionsByProject = new Map<string, SessionInfo[]>();
  for (const session of sessionsForDisplay) {
    const project = workspaceKeyOf(session);
    if (!project) continue;
    const projectSessions = sessionsByProject.get(project);
    if (projectSessions) projectSessions.push(session);
    else sessionsByProject.set(project, [session]);
  }

  const normalizedProjectFilter = projectFilter.trim().toLowerCase();
  const projectGroups = projectPaths.flatMap((project) => {
    const name = projectDisplayName(project);
    const sessions = sessionsByProject.get(project) ?? [];
    if (!normalizedProjectFilter) return [{ project, name, sessions }];

    const projectMatches = name.toLowerCase().includes(normalizedProjectFilter);
    const matchingSessions = sessions.filter((session) => {
      const title = sessionDisplayTitle(session);
      return title.toLowerCase().includes(normalizedProjectFilter);
    });
    if (!projectMatches && matchingSessions.length === 0) return [];
    return [{ project, name, sessions: projectMatches ? sessions : matchingSessions }];
  });

  const showWorktreeSwitcher = Boolean(
    worktreeState?.isGit
    && worktreeState.isTopLevel
    && selectedCwd
    && selectedProject === worktreeState.projectRoot
  );
  const currentWt = worktreeState?.worktrees.find((worktree) => worktree.path === selectedCwd)
    ?? worktreeState?.worktrees.find((worktree) => worktree.isMain);
  const branchesUnavailable = worktreeState !== null && worktreeState.branches === null;
  const branches = worktreeState?.branches ?? [];
  // Checkouts no branch points at (detached HEAD, deleted branch) still need a
  // row: the editor can open them and they can only be removed from here.
  const checkouts = worktreeState?.worktrees ?? [];
  const orphanCheckouts = branchesUnavailable
    ? []
    : checkouts.filter((wt) => !branches.some((branch) => branch.worktreePath === wt.path));
  // Enumeration failed: fall back to the plain checkout list instead of calling
  // every checkout detached.
  const fallbackCheckouts = branchesUnavailable ? checkouts : [];
  const showWtFilter = branches.length + orphanCheckouts.length + fallbackCheckouts.length >= 8;
  // Without the input there is no way to clear a leftover query, so ignore it.
  const filterText = showWtFilter ? wtFilter.trim().toLowerCase() : "";
  const matchesFilter = (value: string) => !filterText || value.toLowerCase().includes(filterText);
  const visibleBranches = branches.filter(
    (branch) => matchesFilter(branch.name) || (branch.worktreePath !== null && matchesFilter(branch.worktreePath)),
  );
  const visibleOrphans = orphanCheckouts.filter((wt) => matchesFilter(wt.path));
  const visibleFallback = fallbackCheckouts.filter((wt) => matchesFilter(wt.branch ?? wt.path));
  const noMatches = visibleBranches.length + visibleOrphans.length + visibleFallback.length === 0;
  const removeConfirmBar = (path: string) => (
    <div
      key={path}
      style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid var(--border)", background: "rgba(239,68,68,0.06)" }}
    >
      <span style={{ flex: 1, fontSize: 11, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {t("sidebar.forceRemoveCheckout")}
      </span>
      <button
        onClick={() => void handleRemoveWorktree(path, true)}
        disabled={wtBusy}
        style={{ padding: "3px 9px", minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined, background: "#ef4444", border: "none", borderRadius: 5, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
      >
        {t("sidebar.force")}
      </button>
      <button
        onClick={() => setWtConfirmRemove(null)}
        style={{ padding: "3px 9px", minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined, background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", fontSize: 11, cursor: "pointer", flexShrink: 0 }}
      >
        {t("sidebar.cancel")}
      </button>
    </div>
  );
  const removeCheckoutButton = (path: string) => (
    <button
      onClick={() => void handleRemoveWorktree(path, false)}
      disabled={wtBusy}
      title={t("sidebar.removeWorktreeTitle", { path })}
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
      onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6M14 11v6" />
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      </svg>
    </button>
  );

  const renderCheckoutRow = (row: {
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
    if (row.confirming && row.path) return removeConfirmBar(row.path);
    return (
    <div
        key={row.key}
      className="wt-row"
      style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)" }}
    >
      <button
          onClick={row.onSelect}
        disabled={wtBusy}
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
        {row.removable && row.path && removeCheckoutButton(row.path)}
    </div>
  );
  };


  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {customPathOpen && (
        <DirectoryPicker
          busy={customPathValidating}
          error={customPathError}
          onCancel={() => {
            setCustomPathOpen(false);
            setCustomPathError(null);
          }}
          onSelect={(path) => void commitCustomPath(path)}
        />
      )}


      <div
        style={{
          padding: "12px 10px 10px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <PiWebTitle />
      </div>


      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          minHeight: 42,
          padding: "6px 8px 4px 14px",
          flexShrink: 0,
          // 排序菜单以整行为定位参照，窄侧栏下右对齐才不会被裁掉左缘。
          position: "relative",
        }}
      >
        <h2 style={{ margin: 0, flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-muted)", fontSize: 13, fontWeight: 600, letterSpacing: "0.01em" }}>
          {t("sidebar.projects")}
        </h2>
        <ProjectSortControl
          mode={projectSortMode}
          open={sortMenuOpen}
          menuRef={sortMenuRef}
          onToggle={() => setSortMenuOpen((open) => !open)}
          onDismiss={closeProjectSortMenu}
          onSelectMode={chooseProjectSortMode}
        />
        <button
          className="sidebar-header-icon-button"
          onClick={() => loadSessions(false, true)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            background: sessionRefreshDone ? "rgba(74,222,128,0.18)" : "var(--bg-hover)",
            border: `1px solid ${sessionRefreshDone ? "rgba(74,222,128,0.4)" : "var(--border)"}`,
            color: sessionRefreshDone ? "#4ade80" : "var(--text-muted)",
            cursor: "pointer",
            width: 32, height: 32,
            borderRadius: 7,
            padding: 0,
            flexShrink: 0,
            transition: "background 0.3s, color 0.3s, border-color 0.3s",
          }}
          onMouseEnter={(event) => {
            if (sessionRefreshDone) return;
            event.currentTarget.style.background = "var(--bg-selected)";
            event.currentTarget.style.color = "var(--accent)";
            event.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
          }}
          onMouseLeave={(event) => {
            if (sessionRefreshDone) return;
            event.currentTarget.style.background = "var(--bg-hover)";
            event.currentTarget.style.color = "var(--text-muted)";
            event.currentTarget.style.borderColor = "var(--border)";
          }}
          title={t("sidebar.refresh")}
        >
          {sessionRefreshDone ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={handleCustomPathClick}
          title={t("sidebar.addProject")}
          aria-label={t("sidebar.addProject")}
          className="sidebar-header-icon-button"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            padding: 0,
            border: "none",
            borderRadius: 6,
            background: "var(--bg-hover)",
            color: "var(--text-muted)",
            cursor: "pointer",
            flexShrink: 0,
            transition: "background 0.12s, color 0.12s",
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = "var(--bg-hover)";
            event.currentTarget.style.color = "var(--text)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = "var(--bg-hover)";
            event.currentTarget.style.color = "var(--text-muted)";
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />
            <path d="M15.5 10.5v5M13 13h5" />
          </svg>
        </button>
      </div>
        <label style={{ position: "relative", display: "block", margin: "0 8px 8px" }}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-dim)", pointerEvents: "none" }}
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setProjectFilter("");
                event.currentTarget.blur();
              }
            }}
            placeholder={t("sidebar.searchProjectsAndSessions")}
            aria-label={t("sidebar.searchProjectsAndSessions")}
            style={{
              width: "100%",
              height: 34,
              padding: "0 10px 0 32px",
              border: "1px solid var(--border)",
              borderRadius: 7,
              outline: "none",
              background: "var(--bg-hover)",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
            }}
          />
        </label>

      <div style={{ flex: "1 1 0", overflowY: "auto", minHeight: 80, padding: "0 6px 10px" }}>
        {loading && (
          <div style={{ padding: "12px 8px", color: "var(--text-muted)", fontSize: 12 }}>
            {t("sidebar.loading")}
          </div>
        )}
        {error && (
          <div style={{ padding: "10px 8px", color: "#f87171", fontSize: 12 }}>
            {error}
          </div>
        )}
        {!loading && !error && projectGroups.length === 0 && (
          <div style={{ padding: "12px 8px", color: "var(--text-muted)", fontSize: 12 }}>
            {normalizedProjectFilter ? t("sidebar.noMatchingProjects") : t("sidebar.noSessions")}
          </div>
        )}
        {!loading && !error && projectGroups.map(({ project, name, sessions }) => {
          const isSelectedProject = selectedProjectKey !== null && normalizeProjectKey(project) === selectedProjectKey;
          const isCollapsed = collapsedProjects.has(project) && !normalizedProjectFilter;
          const isExpanded = expandedProjects.has(project);
          const visibleSessionsForProject = isExpanded ? sessions : sessions.slice(0, PROJECT_SESSION_LIMIT);
          const sessionTree = buildSessionTree(visibleSessionsForProject);
          const showMore = sessions.length > PROJECT_SESSION_LIMIT;

          return (
            <section key={project} style={{ marginBottom: isCollapsed ? 3 : 9 }}>
              <ProjectRow
                project={project}
                name={name}
                isSelected={isSelectedProject}
                isCollapsed={isCollapsed}
                isPinned={pinnedProjectKeys.has(normalizeProjectKey(project))}
                activity={projectActivity.get(project)}
                hovered={hoveredProject === project}
                menuOpen={projectMenuOpen === project}
                menuRef={projectMenuOpen === project ? wtDropdownRef : undefined}
                highlightActions={Boolean(isSelectedProject && currentWt && !currentWt.isMain)}
                onToggleCollapse={() => toggleProjectCollapsed(project)}
                onSelect={() => setSelectedCwd(project)}
                onNewSession={() => handleNewSession(project)}
                onToggleMenu={() => {
                  const nextOpen = projectMenuOpen === project ? null : project;
                  dismissProjectMenu();
                  setProjectMenuOpen(nextOpen);
                  if (!isSelectedProject) setSelectedCwd(project);
                }}
                onHoverChange={(next) => setHoveredProject((current) => (next ? project : current === project && projectMenuOpen !== project ? null : current))}
              >

                    <AnimatedDropdown
                      open={projectMenuOpen === project}
                      style={{
                        position: "absolute",
                        top: "calc(100% + 4px)",
                        right: 3,
                        width: "min(260px, calc(100vw - 24px))",
                        zIndex: 110,
                        background: "var(--bg)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        boxShadow: "0 6px 20px rgba(0,0,0,0.14)",
                        boxSizing: "border-box",
                        overflow: "hidden",
                      }}
                    >
                      {showWorktreeSwitcher && worktreeState && (
                        <>
                          <button
                            type="button"
                        onClick={() => {
                          if (wtDropdownOpen) closeWtPanel();
                          else setWtDropdownOpen(true);
                        }}
                        title={t("sidebar.switchBranch")}
                        aria-label={t("sidebar.switchBranch")}
                            aria-expanded={wtDropdownOpen}
                            style={{
                              ...projectMenuRowStyle(isMobile),
                              border: "none",
                              borderBottom: wtDropdownOpen ? "1px solid var(--border)" : "none",
                              background: wtDropdownOpen ? "var(--bg-selected)" : "transparent",
                              color: "var(--text-muted)",
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <line x1="6" y1="3" x2="6" y2="15" />
                              <circle cx="18" cy="6" r="3" />
                              <circle cx="6" cy="18" r="3" />
                              <path d="M18 9a9 9 0 0 1-9 9" />
                            </svg>
                            <span style={{ flex: 1 }}>{t("sidebar.worktrees")}</span>
                            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <polyline points="4 2.5 8 6 4 9.5" />
                            </svg>
                          </button>
                          <AnimatedDropdown
                open={wtDropdownOpen}
                            style={{
                              position: "static",
                              width: "auto",
                              zIndex: 100,
                              background: "var(--bg)",
                              border: "none",
                              borderTop: "1px solid var(--border)",
                              borderRadius: 0,
                              boxShadow: "none",
                              boxSizing: "border-box",
                              overflow: "hidden",
                            }}
              >
                  {showWtFilter && (
                    <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                      <input
                        value={wtFilter}
                        onChange={(e) => setWtFilter(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setWtFilter("");
                            setWtDropdownOpen(false);
                          }
                        }}
                        placeholder={t("sidebar.filterWorktrees")}
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
                            const holder = holderPath ? checkouts.find((wt) => wt.path === holderPath) : null;
                            const isMain = holder?.isMain === true;
                            let stateLabel = t("sidebar.branchNoCheckout");
                            if (holderPath) {
                              stateLabel = isMain ? t("sidebar.mainCheckout") : t("sidebar.hasCheckout");
                            }
                            return renderCheckoutRow({
                              key: branch.name,
                              path: holderPath,
                              title: holderPath ?? t("sidebar.branchNoCheckoutTitle", { branch: branch.name }),
                              checked: branch.current,
                              label: branch.name,
                              tag: stateLabel,
                              removable: Boolean(holderPath) && !isMain,
                              confirming: Boolean(holderPath) && wtConfirmRemove === holderPath,
                              onSelect: () => void handleSwitchBranch(branch),
                            });
                          })}
                          {visibleOrphans.map((wt) => renderCheckoutRow({
                            key: wt.path,
                            path: wt.path,
                            title: wt.path,
                            checked: wt.path === selectedCwd,
                            label: wt.path,
                            tag: t("sidebar.detachedCheckout"),
                            removable: !wt.isMain,
                            confirming: wtConfirmRemove === wt.path,
                            onSelect: () => {
                              setSelectedCwd(wt.path);
                              closeWtPanel();
                            },
                          }))}
                          {visibleFallback.map((wt) => renderCheckoutRow({
                            key: wt.path,
                            path: wt.path,
                            title: wt.path,
                            checked: wt.path === selectedCwd,
                            label: wt.branch ?? wt.path,
                            removable: !wt.isMain,
                            confirming: wtConfirmRemove === wt.path,
                            onSelect: () => {
                              setSelectedCwd(wt.path);
                              closeWtPanel();
                            },
                          }))}
                          {showWtFilter && noMatches && filterText.length > 0 && (
                      <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-dim)" }}>{t("sidebar.noMatchingWorktrees")}</div>
                    )}
                  </div>

                  {!wtNewOpen ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setWtNewOpen(true);
                        setWtError(null);
                        setTimeout(() => wtNewInputRef.current?.focus(), 0);
                      }}
                      title={t("sidebar.createWorktreeTitle")}
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
                       <span>{t("sidebar.newWorktree")}</span>
                    </button>
                  ) : (
                    <div style={{ padding: "6px 8px" }}>
                      <input
                        ref={wtNewInputRef}
                        value={wtNewBranch}
                        onChange={(e) => {
                          setWtNewBranch(e.target.value);
                          setWtError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleCreateWorktree();
                          }
                          if (e.key === "Escape") {
                            setWtNewOpen(false);
                            setWtNewBranch("");
                            setWtError(null);
                          }
                        }}
                         placeholder={t("sidebar.branchName")}
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
                          onClick={() => void handleCreateWorktree()}
                          disabled={wtBusy || !wtNewBranch.trim()}
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
                            cursor: wtBusy || !wtNewBranch.trim() ? "not-allowed" : "pointer",
                            opacity: wtBusy || !wtNewBranch.trim() ? 0.65 : 1,
                          }}
                        >
                           {wtBusy ? t("sidebar.creating") : t("sidebar.create")}
                        </button>
                        <button
                          onClick={() => { setWtNewOpen(false); setWtNewBranch(""); setWtError(null); }}
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
                  {wtError && (
                    <div style={{
                      padding: "5px 10px 8px",
                      color: "#dc2626",
                      fontSize: 11,
                      lineHeight: 1.35,
                      overflowWrap: "anywhere",
                    }}>
                      {wtError}
                    </div>
                  )}
              </AnimatedDropdown>
                          </>
                        )}
                        <ProjectPinMenuItem
                          isPinned={pinnedProjectKeys.has(normalizeProjectKey(project))}
                          onToggle={() => handleTogglePinnedProject(project)}
                        />
                        {removeProjectConfirm?.project === project ? (
                          <div
                            style={{
                              ...projectMenuRowStyle(isMobile),
                              flexDirection: "column",
                              alignItems: "stretch",
                              gap: 6,
                              padding: "7px 10px",
                              borderTop: "1px solid var(--border)",
                              background: "color-mix(in srgb, var(--danger) 6%, transparent)",
                            }}
                          >
                            <span style={{ fontSize: 11, color: "var(--text)", lineHeight: 1.35 }}>
                              {t("sidebar.removeProjectBusy", { count: removeProjectConfirm.count })}
                            </span>
                            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                              <button
                                type="button"
                                onClick={() => executeRemoveProject(project)}
                                style={{ padding: "3px 9px", minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined, background: "var(--danger)", border: "none", borderRadius: 5, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
                              >
                                {t("sidebar.removeProjectAnyway")}
                              </button>
                              <button
                                type="button"
                                onClick={() => setRemoveProjectConfirm(null)}
                                style={{ padding: "3px 9px", minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined, background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", fontSize: 11, cursor: "pointer", flexShrink: 0 }}
                              >
                                {t("sidebar.cancel")}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => requestRemoveProject(project)}
                            title={t("sidebar.removeProjectTitle")}
                            style={{
                              ...projectMenuRowStyle(isMobile),
                              border: "none",
                              borderTop: "1px solid var(--border)",
                              background: "transparent",
                              color: "var(--danger)",
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                            onMouseEnter={(event) => {
                              event.currentTarget.style.background = "color-mix(in srgb, var(--danger) 10%, transparent)";
                            }}
                            onMouseLeave={(event) => {
                              event.currentTarget.style.background = "transparent";
                            }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                              <path d="M10 11v6M14 11v6" />
                              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                            </svg>
                            {t("sidebar.removeProject")}
                          </button>
                        )}
                    </AnimatedDropdown>
              </ProjectRow>

              {!isCollapsed && sessions.length === 0 && isSelectedProject && (
                <div style={{ padding: "6px 12px 7px 32px", color: "var(--text-dim)", fontSize: 11 }}>
                  {t("sidebar.noSessions")}
                </div>
              )}
              {!isCollapsed && sessionTree.length > 0 && (
                <div style={{ paddingLeft: 12 }}>
                  {sessionTree.map((node) => (
                    <SessionTreeItem
                      key={node.session.id}
                      node={node}
                      selectedSessionId={selectedSessionId}
                      runningSessionIds={runningSessionIds}
                      waitingSessionIds={waitingSessionIds}
                      unreadSessionIds={unreadSessionIds}
                      onSelectSession={handleSelectSessionFromList}
                      onRenamed={loadSessions}
                      onSessionDeleted={(id) => {
                        onSessionDeleted?.(id);
                        loadSessions();
                      }}
                      onSessionArchived={handleSessionArchived}
                      depth={0}
                    />
                  ))}
                </div>
              )}
              {!isCollapsed && showMore && (
                <button
                  type="button"
                  className="sidebar-show-more"
                  onClick={() => {
                    setExpandedProjects((current) => {
                      const next = new Set(current);
                      if (next.has(project)) next.delete(project);
                      else next.add(project);
                      return next;
                    });
                  }}
                  style={{
                    display: "block",
                    margin: "3px 0 3px 32px",
                    padding: "5px 8px",
                    border: "none",
                    background: "transparent",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 12,
                    textAlign: "left",
                  }}
                >
                  {isExpanded ? t("sidebar.showLess") : t("sidebar.showMore")}
                </button>
              )}
            </section>
          );
        })}
      </div>

      <ArchivedSessionsSection
        refreshKey={archiveRefreshKey}
        selectedSessionId={selectedSessionId}
        onSelectSession={handleSelectSessionFromList}
        onRestored={handleSessionArchived}
      />
    </div>
  );
}

function ArchivedSessionsSection({
  refreshKey,
  selectedSessionId,
  onSelectSession,
  onRestored,
}: {
  refreshKey: number;
  selectedSessionId: string | null;
  onSelectSession: (s: SessionInfo) => void;
  onRestored: (id: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/sessions?archived=1", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { sessions: SessionInfo[] };
        if (!cancelled) setSessions(data.sessions);
      } catch {
        // Archived section is best-effort; a failed fetch just leaves it stale.
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const restore = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: false }),
      });
      onRestored(id);
    } catch {
      // ignore
    }
  }, [onRestored]);

  if (sessions.length === 0 && !open) return null;

  return (
    <section style={{ borderTop: "1px solid var(--border)", marginTop: 4 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="sidebar-archived-toggle"
        style={{
          display: "flex", alignItems: "center", gap: 6,
          width: "100%", padding: "7px 12px",
          background: "transparent", border: "none",
          color: "var(--text-muted)", cursor: "pointer",
          fontSize: 12, fontWeight: 600, textAlign: "left",
        }}
      >
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.1s" }}
        >
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
        {t("sidebar.archived")} ({sessions.length})
      </button>
      {open && (
        <div style={{ paddingLeft: 12 }}>
          {sessions.length === 0 && (
            <div style={{ padding: "4px 12px 8px 20px", color: "var(--text-dim)", fontSize: 11 }}>
              {t("sidebar.noArchivedSessions")}
            </div>
          )}
          {sessions.map((s) => {
            const title = sessionDisplayTitle(s);
            return (
              <div
                key={s.id}
                data-session-id={s.id}
                className="sidebar-session-row"
                onClick={() => onSelectSession(s)}
                style={{
                  height: 40, display: "flex", alignItems: "center",
                  paddingLeft: 20, paddingRight: 4, gap: 4,
                  cursor: "pointer", overflow: "hidden",
                  borderLeft: s.id === selectedSessionId ? "2px solid var(--accent)" : "2px solid transparent",
                  background: s.id === selectedSessionId ? "var(--bg-selected)" : "transparent",
                }}
              >
                <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {title}
                </div>
                <button
                  className="sidebar-session-restore-button"
                  onClick={(e) => restore(e, s.id)}
                  title={t("sidebar.restore")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    height: 24, padding: "0 8px", flexShrink: 0,
                    background: "var(--bg)", border: "1px solid var(--border)",
                    borderRadius: 5, color: "var(--text-muted)",
                    cursor: "pointer", fontSize: 11, fontWeight: 500,
                  }}
                >
                  {t("sidebar.restore")}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SessionTreeItem({
  node,
  selectedSessionId,
  runningSessionIds,
  waitingSessionIds,
  unreadSessionIds,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  onSessionArchived,
  depth,
}: {
  node: SessionTreeNode;
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  waitingSessionIds: Set<string>;
  unreadSessionIds: ReadonlySet<string>;
  onSelectSession: (s: SessionInfo) => void;
  onRenamed?: () => void;
  onSessionDeleted?: (id: string) => void;
  onSessionArchived?: (id: string) => void;
  depth: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div style={{ position: "relative" }}>
        {/* Indent line for child sessions */}
        {depth > 0 && (
          <div style={{
            position: "absolute",
            left: depth * 12 + 6,
            top: 0, bottom: 0,
            width: 1,
            background: "var(--border)",
            pointerEvents: "none",
          }} />
        )}
        <SessionItem
          session={node.session}
          isSelected={node.session.id === selectedSessionId}
          isRunning={runningSessionIds.has(node.session.id)}
          isWaiting={waitingSessionIds.has(node.session.id)}
          isUnread={unreadSessionIds.has(node.session.id)}
          onClick={() => onSelectSession(node.session)}
          onRenamed={onRenamed}
          onDeleted={(id) => onSessionDeleted?.(id)}
          onArchived={(id) => onSessionArchived?.(id)}
          depth={depth}
          hasChildren={hasChildren}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
        />
      </div>
      {hasChildren && !collapsed && (
        <div>
          {node.children.map((child) => (
            <SessionTreeItem
              key={child.session.id}
              node={child}
              selectedSessionId={selectedSessionId}
              runningSessionIds={runningSessionIds}
              waitingSessionIds={waitingSessionIds}
              unreadSessionIds={unreadSessionIds}
              onSelectSession={onSelectSession}
              onRenamed={onRenamed}
              onSessionDeleted={onSessionDeleted}
              onSessionArchived={onSessionArchived}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RunningSessionIndicator() {
  const { t } = useI18n();
  return (
    <span
      title={t("sidebar.agentRunning")}
      aria-label={t("sidebar.agentRunning")}
      role="img"
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <g>
          <path
            d="M21 12a9 9 0 1 1-3.8-7.4"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 12 12"
            to="360 12 12"
            dur="0.9s"
            repeatCount="indefinite"
          />
        </g>
      </svg>
    </span>
  );
}

/**
 * 黄环：会话仍在运行，但停在提问表单上等待用户作答。
 *
 * 用完整圆环加呼吸明暗区别于运行中的旋转缺口圆环：形状一闭一缺，动静一停一转。
 */
function WaitingSessionIndicator() {
  const { t } = useI18n();
  return (
    <span
      title={t("sidebar.agentWaitingForInput")}
      aria-label={t("sidebar.agentWaitingForInput")}
      role="img"
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--warning)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="2">
          <animate attributeName="r" values="4.2;5;4.2" dur="1.8s" repeatCount="indefinite" />
          <animate attributeName="stroke-opacity" values="1;0.4;1" dur="1.8s" repeatCount="indefinite" />
        </circle>
      </svg>
    </span>
  );
}

/** 静态生命周期标记：实心圆点，没有动画；五种结果靠颜色与无障碍文字区分。 */
function StaticSessionMarker({ status }: { status: StaticMarkerStatus }) {
  const { t } = useI18n();
  const { color, labelKey } = STATIC_MARKER_APPEARANCE[status];
  return (
    <span
      title={t(labelKey)}
      aria-label={t(labelKey)}
      role="img"
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <circle cx="7" cy="7" r="4" fill="currentColor" />
      </svg>
    </span>
  );
}

function SessionItem({
  session,
  isSelected,
  isRunning,
  isWaiting,
  isUnread,
  onClick,
  onRenamed,
  onDeleted,
  onArchived,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
}: {
  session: SessionInfo;
  isSelected: boolean;
  isRunning?: boolean;
  /** 运行中但停在提问表单上，等待用户作答。 */
  isWaiting?: boolean;
  isUnread?: boolean;
  onClick: () => void;
  onRenamed?: () => void;
  onDeleted?: (id: string) => void;
  onArchived?: (id: string) => void;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Select the whole name once the rename input is mounted (startRename's
  // immediate setTimeout can fire before the input exists).
  useEffect(() => {
    if (renaming) {
      const id = requestAnimationFrame(() => inputRef.current?.select());
      return () => cancelAnimationFrame(id);
    }
  }, [renaming]);

  // A stored first message may hold an SDK-expanded <skill> block;
  // sessionDisplayTitle collapses it to the compact command form, so the
  // fallback title matches the one the top bar renders.
  const title = sessionDisplayTitle(session);

  // 一行只保留一个标记槽位：动态标记优先，静态标记在点开会话后熄灭。
  const marker = resolveSessionMarker({
    status: session.status,
    isRunning,
    isWaiting,
    isUnread: isUnread === true,
  });

  const startRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // Transient sessions have no file yet, so renaming would fail.
    if (session.transient) return;
    setRenameValue(title);
    setRenaming(true);
  }, [session.transient, title]);

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    setRenaming(false);
    // No-op when unchanged: the fallback title (first message / id) isn't a
    // real stored name, so don't persist it as one. The rename input seeds from
    // the same collapsed title, so an untouched rename of a skill-invoked
    // session stays a no-op instead of persisting raw XML.
    if (renameValue === title || name === (session.name ?? "")) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      onRenamed?.();
    } catch {
      // ignore
    }
  }, [renameValue, session.id, session.name, onRenamed, title]);

  const performDelete = useCallback(async () => {
    if (session.transient) return;
    setConfirmDelete(false);
    setDeleting(true);
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      onDeleted?.(session.id);
    } catch {
      setDeleting(false);
    }
  }, [session.id, session.transient, onDeleted]);

  const performArchive = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (session.transient) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      onArchived?.(session.id);
    } catch {
      // ignore
    }
  }, [session.id, session.transient, onArchived]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey) {
      void performDelete();
    } else {
      setConfirmDelete(true);
    }
  }, [performDelete]);

  const handleDeleteConfirm = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    void performDelete();
  }, [performDelete]);

  const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const handled = dispatchSessionRowContextMenu({
      id: session.id,
      path: session.path,
      cwd: session.cwd,
      name: session.name,
      clientX: e.clientX,
      clientY: e.clientY,
      refresh: () => { onRenamed?.(); },
    });
    if (!handled) return;
    e.preventDefault();
    e.stopPropagation();
  }, [onRenamed, session.cwd, session.id, session.name, session.path]);

  // Fixed height keeps hover and confirmation states from reflowing the list.
  const ITEM_HEIGHT = 40;

  return (
    <div
      data-session-id={session.id}
      className="sidebar-session-row"
      onClick={confirmDelete || renaming ? undefined : onClick}
      onContextMenu={confirmDelete || renaming ? undefined : handleContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
      style={{
        height: ITEM_HEIGHT,
        display: "flex",
        alignItems: "center",
        paddingLeft: depth > 0 ? depth * 10 + 8 : 8,
        paddingRight: 4,
        cursor: confirmDelete || renaming ? "default" : "pointer",
        background: confirmDelete
          ? "rgba(239,68,68,0.06)"
          : isSelected ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent",
        borderLeft: confirmDelete
          ? "2px solid #ef4444"
          : isSelected ? "2px solid var(--accent)" : "2px solid transparent",
        transition: "background 0.1s",
        opacity: deleting ? 0.5 : 1,
        gap: 4,
        overflow: "hidden",
      }}
    >
      {confirmDelete ? (
        /* ── Delete confirmation: same height, two flat buttons ── */
        <>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("sidebar.deleteSession", { title: title.slice(0, 22) + (title.length > 22 ? "…" : "") })}
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            <button
              onClick={handleDeleteConfirm}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                height: 30, padding: "0 11px",
                background: "#ef4444", border: "none",
                borderRadius: 6, color: "#fff",
                cursor: "pointer", fontSize: 12, fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
              {t("sidebar.delete")}
            </button>
            <button
              onClick={handleDeleteCancel}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                height: 30, padding: "0 11px",
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 6, color: "var(--text-muted)",
                cursor: "pointer", fontSize: 12, fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              {t("sidebar.cancel")}
            </button>
          </div>
        </>
      ) : renaming ? (
        /* ── Rename: input fills the same row ── */
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          autoFocus
          style={{
            flex: 1,
            fontSize: 12,
            padding: "5px 8px",
            border: "1px solid var(--accent)",
            borderRadius: 5,
            outline: "none",
            background: "var(--bg)",
            color: "var(--text)",
            height: 30,
          }}
        />
      ) : (
        /* ── Normal view ── */
        <>
          {/* Fork indicator for child sessions */}
          {depth > 0 && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
          )}
          <div
            title={title}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flex: 1,
              minWidth: 0,
              color: "var(--text)",
              fontSize: 12.5,
              fontWeight: isSelected ? 500 : 400,
              lineHeight: 1.35,
            }}
          >
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {title}
            </span>
            {marker?.kind === "awaiting" && <WaitingSessionIndicator />}
            {marker?.kind === "running" && <RunningSessionIndicator />}
            {marker?.kind === "static" && <StaticSessionMarker status={marker.status} />}
            {session.worktreeBranch && (
              <span title={t("sidebar.worktreePath", { path: session.cwd })} style={{ display: "flex", color: "var(--accent)", flexShrink: 0 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="6" y1="3" x2="6" y2="15" />
                  <circle cx="18" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path d="M18 9a9 9 0 0 1-9 9" />
                </svg>
              </span>
            )}
          </div>

          {/* Collapse toggle — always visible when has children */}
          {hasChildren && (
            <button
              className="sidebar-project-icon-button"
              onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
              title={collapsed ? t("sidebar.expandForks") : t("sidebar.collapseForks")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 20, height: 20, padding: 0, flexShrink: 0,
                background: "none", border: "none",
                color: "var(--text-dim)", cursor: "pointer",
                transform: collapsed ? "rotate(-90deg)" : "none",
                transition: "transform 0.15s",
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2 3.5 5 6.5 8 3.5" />
              </svg>
            </button>
          )}

          {/* Action buttons — hover on desktop, also while selected on touch */}
          {(hovered || (isMobile && isSelected)) && !session.transient && (
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              <button
                className="sidebar-session-action-button"
                onClick={startRename}
                title={t("sidebar.rename")}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 26, height: 26, padding: 0,
                  background: "transparent", border: "none",
                  borderRadius: 5, color: "var(--text-muted)",
                  cursor: "pointer", flexShrink: 0,
                  transition: "background 0.12s, color 0.12s, border-color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-selected)";
                  e.currentTarget.style.color = "var(--accent)";
                  e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.borderColor = "transparent";
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
              </button>
              <button
                className="sidebar-session-action-button"
                onClick={performArchive}
                title={t("sidebar.archive")}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 26, height: 26, padding: 0,
                  background: "transparent", border: "none",
                  borderRadius: 5, color: "var(--text-muted)",
                  cursor: "pointer", flexShrink: 0,
                  transition: "background 0.12s, color 0.12s, border-color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-selected)";
                  e.currentTarget.style.color = "var(--accent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="4" rx="1" />
                  <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
                  <path d="M10 12h4" />
                </svg>
              </button>
              <button
                className="sidebar-session-action-button"
                onClick={handleDeleteClick}
                title={t("sidebar.deleteWithShiftClick")}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 26, height: 26, padding: 0,
                  background: "transparent", border: "none",
                  borderRadius: 5, color: "var(--text-muted)",
                  cursor: "pointer", flexShrink: 0,
                  transition: "background 0.12s, color 0.12s, border-color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(239,68,68,0.08)";
                  e.currentTarget.style.color = "#ef4444";
                  e.currentTarget.style.borderColor = "rgba(239,68,68,0.35)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.borderColor = "transparent";
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
