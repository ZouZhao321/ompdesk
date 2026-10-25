/**
 * 未读会话集合的共享状态。
 *
 * 侧栏的静态标记与项目角标从这里读；任何一个「用户主动打开会话」的入口都从这里
 * 清。状态放在模块里而不是某个组件的 state 里，命令面板、通知点击之类的打开路径
 * 因此和侧栏点击走同一条规则。本机存储只保存 id 列表，刷新后仍然亮着，直到用户
 * 真的点开对应会话。
 */

const UNREAD_SESSIONS_STORAGE_KEY = "ompdesk:unread-session-ids";

const EMPTY_UNREAD_SESSION_IDS: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

let unreadSessionIds: ReadonlySet<string> = EMPTY_UNREAD_SESSION_IDS;
let hydrated = false;

function emit(): void {
  listeners.forEach((listener) => listener());
}

function readStoredUnreadSessionIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(UNREAD_SESSIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function persist(next: ReadonlySet<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (next.size === 0) window.localStorage.removeItem(UNREAD_SESSIONS_STORAGE_KEY);
    else window.localStorage.setItem(UNREAD_SESSIONS_STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

/** 首次接触时补齐本机存储；服务端渲染永远看到空集合。 */
function ensureHydrated(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  unreadSessionIds = readStoredUnreadSessionIds();
}

function commit(next: ReadonlySet<string>): void {
  unreadSessionIds = next;
  persist(next);
  emit();
}

export function subscribeUnreadSessionIds(listener: () => void): () => void {
  ensureHydrated();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getUnreadSessionIds(): ReadonlySet<string> {
  ensureHydrated();
  return unreadSessionIds;
}

export function getServerUnreadSessionIds(): ReadonlySet<string> {
  return EMPTY_UNREAD_SESSION_IDS;
}

/** 把会话记为未读；已经在集合里的 id 不触发订阅。 */
export function addUnreadSessionIds(ids: Iterable<string>): void {
  ensureHydrated();
  const missing = [...ids].filter((id) => !unreadSessionIds.has(id));
  if (missing.length === 0) return;
  commit(new Set([...unreadSessionIds, ...missing]));
}

/** 熄灭标记：用户打开会话、会话再次运行、或会话被删除时都走这里。 */
export function clearUnreadSessionIds(ids: Iterable<string>): void {
  ensureHydrated();
  const removable = [...ids];
  if (!removable.some((id) => unreadSessionIds.has(id))) return;
  const next = new Set(unreadSessionIds);
  removable.forEach((id) => next.delete(id));
  commit(next);
}

/** 丢掉已经不存在的会话，避免本机存储留着永远点不到的 id。 */
export function retainUnreadSessionIds(existingIds: ReadonlySet<string>): void {
  ensureHydrated();
  clearUnreadSessionIds([...unreadSessionIds].filter((id) => !existingIds.has(id)));
}
