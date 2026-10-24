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

/**
 * 按工作区汇总命中 `sessionIds` 的会话数量。
 *
 * 只统计同时出现在 `sessions` 与 `sessionIds` 中的会话；集合里无法对应到会话的 id
 * 会被忽略。返回值只包含至少有一个命中会话的工作区。
 */
export function countSessionsByWorkspace(
  sessions: readonly SessionInfo[],
  sessionIds: ReadonlySet<string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const workspaceKey = workspaceKeyOf(session);
    if (!workspaceKey) continue;
    if (!sessionIds.has(session.id)) continue;
    counts.set(workspaceKey, (counts.get(workspaceKey) ?? 0) + 1);
  }
  return counts;
}
