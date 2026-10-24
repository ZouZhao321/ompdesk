import type { SessionInfo } from "./types";

/**
 * 会话所属的工作区键：已知 projectRoot 时用 projectRoot，否则用 cwd。
 *
 * 不做路径归一化或大小写折叠；工作区记忆与侧边栏项目分组共用这一规则。
 */
export function workspaceKeyOf(session: {
  cwd: string;
  projectRoot?: string | null;
}): string {
  return session.projectRoot ?? session.cwd;
}

/** 单个工作区的会话活动计数。 */
export interface WorkspaceActivity {
  /** 正在干活：在运行集合且不在等待集合。 */
  active: number;
  /** 停在阻塞式 UI 请求上等待用户回答。 */
  waiting: number;
  /** 运行与等待的并集，同一会话只计一次。 */
  busy: number;
}

/**
 * 一次遍历汇总每个工作区的活动计数。
 *
 * `busy` 是运行集合与等待集合的并集：两个集合来源独立，等待不一定是运行的子集，
 * 所以 `active + waiting` 与 `busy` 必须分别统计。只输出至少命中一项的工作区；
 * 集合里无法对应到会话的 id 会被忽略。
 */
export function summarizeWorkspaceActivity(
  sessions: readonly SessionInfo[],
  runningSessionIds: ReadonlySet<string>,
  waitingSessionIds: ReadonlySet<string>,
): Map<string, WorkspaceActivity> {
  const summary = new Map<string, WorkspaceActivity>();
  for (const session of sessions) {
    const running = runningSessionIds.has(session.id);
    const waiting = waitingSessionIds.has(session.id);
    if (!running && !waiting) continue;
    const workspaceKey = workspaceKeyOf(session);
    if (!workspaceKey) continue;
    let entry = summary.get(workspaceKey);
    if (!entry) {
      entry = { active: 0, waiting: 0, busy: 0 };
      summary.set(workspaceKey, entry);
    }
    entry.busy += 1;
    if (waiting) entry.waiting += 1;
    else entry.active += 1;
  }
  return summary;
}
