import type { SessionActivitySnapshot, SessionInfo } from "./types";

/** 会话列表接口的响应：会话数组、活动快照与归档条数。 */
type SessionListResponse = SessionActivitySnapshot & {
  sessions: SessionInfo[];
  /** 归档区尚未展开时用这个数字决定是否显示入口，避免为它单独拉一次列表。 */
  archivedCount: number;
};

/** 同一次页面生命周期内并发发起的列表读取共用一个请求；force 始终直接访问服务端。 */
let listInflight: Promise<SessionListResponse> | null = null;
let archivedInflight: Promise<SessionInfo[]> | null = null;

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** 读取会话列表。非 force 的并发调用合并为一次请求。 */
export function fetchSessionList(force = false): Promise<SessionListResponse> {
  if (force) {
    return fetch("/api/sessions?force=1", { cache: "no-store" }).then((r) => readJson<SessionListResponse>(r));
  }
  if (!listInflight) {
    listInflight = fetch("/api/sessions", { cache: "no-store" })
      .then((r) => readJson<SessionListResponse>(r))
      .finally(() => {
        listInflight = null;
      });
  }
  return listInflight;
}

/** 读取归档会话；只在归档区展开时调用，同样合并并发请求。 */
export function fetchArchivedSessions(): Promise<SessionInfo[]> {
  if (!archivedInflight) {
    archivedInflight = fetch("/api/sessions?archived=1", { cache: "no-store" })
      .then((r) => readJson<{ sessions: SessionInfo[] }>(r))
      .then((data) => data.sessions)
      .finally(() => {
        archivedInflight = null;
      });
  }
  return archivedInflight;
}
