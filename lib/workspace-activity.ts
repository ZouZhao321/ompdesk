import type { SessionInfo } from "./types";

/**
 * 按工作区汇总运行中的会话数量。
 *
 * 工作区键与侧边栏项目行保持一致：`projectRoot ?? cwd`，不做路径归一化或大小写折叠。
 * 只统计同时出现在 `sessions` 与 `runningSessionIds` 中的会话；运行集合里无法对应到
 * 会话的 id 会被忽略。返回值只包含至少有一个运行中会话的工作区。
 */
export function countRunningSessionsByWorkspace(
  sessions: readonly SessionInfo[],
  runningSessionIds: ReadonlySet<string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const workspaceKey = session.projectRoot ?? session.cwd;
    if (!workspaceKey) continue;
    if (!runningSessionIds.has(session.id)) continue;
    counts.set(workspaceKey, (counts.get(workspaceKey) ?? 0) + 1);
  }
  return counts;
}
