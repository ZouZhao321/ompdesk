import type { SessionInfo } from "./types";
import { workspaceKeyOf } from "./workspace-activity";

export interface ProjectActivity {
  path: string;
  sessions: number;
  running: number;
  waiting: number;
}

export interface SessionActivity {
  running: number;
  waiting: number;
  projects: ProjectActivity[];
}

/**
 * Group the session list by workspace for `ompdesk status`.
 *
 * Session counts come from the list handed in — the same one the sidebar shows,
 * so a project keeps its row after its last turn ends. `running` and `waiting`
 * come from the runtime snapshot: they answer "what would stopping now
 * interrupt", which is why `stop` refuses on `running` and not on `sessions`.
 *
 * The workspace key comes from `workspaceKeyOf`, the rule the sidebar groups by,
 * so a worktree session counts under its main checkout on both surfaces.
 */
export function groupSessionActivity(
  sessions: readonly SessionInfo[],
  runningSessionIds: readonly string[],
  waitingSessionIds: readonly string[],
): SessionActivity {
  const running = new Set(runningSessionIds);
  const waiting = new Set(waitingSessionIds);
  const byProject = new Map<string, ProjectActivity>();

  for (const session of sessions) {
    const projectPath = workspaceKeyOf(session);
    const project = byProject.get(projectPath) ?? { path: projectPath, sessions: 0, running: 0, waiting: 0 };
    project.sessions += 1;
    if (running.has(session.id)) project.running += 1;
    if (waiting.has(session.id)) project.waiting += 1;
    byProject.set(projectPath, project);
  }

  const projects = [...byProject.values()].sort((left, right) => (
    right.running - left.running
    || right.waiting - left.waiting
    || left.path.localeCompare(right.path)
  ));

  return {
    running: runningSessionIds.length,
    waiting: waitingSessionIds.length,
    projects,
  };
}
