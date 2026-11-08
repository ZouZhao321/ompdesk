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
    // A session with neither a project root nor a cwd has no row on the page
    // either; grouping it under "" would print a phantom project.
    if (!projectPath) continue;
    const project = byProject.get(projectPath) ?? { path: projectPath, sessions: 0, running: 0, waiting: 0 };
    project.sessions += 1;
    if (running.has(session.id)) project.running += 1;
    if (waiting.has(session.id)) project.waiting += 1;
    byProject.set(projectPath, project);
  }

  // Code-unit comparison, not `localeCompare`: this lands in a terminal, and the
  // same sessions must print in the same order on every machine. `localeCompare`
  // depends on the runtime's ICU data, which `lib/project-order.ts` also avoids
  // for the same reason.
  const projects = [...byProject.values()].sort((left, right) => (
    right.running - left.running
    || right.waiting - left.waiting
    || (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  ));

  // Totals stay tied to the runtime snapshot, not to the project rows: the
  // snapshot also holds sessions this list cannot place (running before the
  // first turn is persisted). Deriving the total from the rows would make `stop`
  // stop refusing for a task nobody can see, which silently interrupts work.
  // The caller reports the difference instead of hiding it.
  return {
    running: runningSessionIds.length,
    waiting: waitingSessionIds.length,
    projects,
  };
}
