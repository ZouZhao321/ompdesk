import type { SessionInfo } from "@/lib/types";

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
 * Group live sessions by project for `ompdesk status`.
 *
 * Only sessions the server process is actually holding appear here: a session
 * on disk that nothing is running is not something the daemon can interrupt, so
 * counting it would overstate what `stop` would break. Projects are ordered by
 * running, then waiting, then path, so the project holding work comes first.
 */
export function groupSessionActivity(
  sessions: SessionInfo[],
  runningSessionIds: string[],
  waitingSessionIds: string[],
): SessionActivity {
  const running = new Set(runningSessionIds);
  const waiting = new Set(waitingSessionIds);
  const byProject = new Map<string, ProjectActivity>();

  for (const session of sessions) {
    const projectPath = session.projectRoot ?? session.cwd;
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
