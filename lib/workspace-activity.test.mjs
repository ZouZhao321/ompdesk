import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { countRunningSessionsByWorkspace } = await createJiti(import.meta.url).import("./workspace-activity.ts");

function session(id, cwd, projectRoot, extra = {}) {
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd,
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 0,
    firstMessage: "",
    projectRoot,
    ...extra,
  };
}

test("counts running sessions grouped by their workspace key", () => {
  const sessions = [
    session("a", "/repo", "/repo"),
    session("b", "/repo", "/repo"),
    session("c", "/other", "/other"),
  ];

  const counts = countRunningSessionsByWorkspace(sessions, new Set(["a", "b"]));

  assert.equal(counts.get("/repo"), 2);
  assert.equal(counts.has("/other"), false);
  assert.equal(counts.size, 1);
});

test("ignores running ids that belong to sessions outside the session list", () => {
  const sessions = [session("a", "/repo", "/repo")];

  const counts = countRunningSessionsByWorkspace(sessions, new Set(["a", "elsewhere"]));

  assert.equal(counts.get("/repo"), 1);
  assert.equal(counts.size, 1);
});

test("returns nothing when no session is running", () => {
  const sessions = [
    session("a", "/repo", "/repo"),
    session("b", "/repo/.worktrees/a", "/repo"),
    session("c", "/plain/dir", undefined),
  ];

  const counts = countRunningSessionsByWorkspace(sessions, new Set());

  assert.equal(counts.get("/repo") ?? 0, 0);
  assert.equal(counts.size, 0);
});

test("sums several worktrees under one project root", () => {
  const sessions = [
    session("main", "/repo", "/repo"),
    session("feat-a", "/repo/.worktrees/a", "/repo"),
    session("feat-b", "/repo/.worktrees/b", "/repo"),
  ];

  const counts = countRunningSessionsByWorkspace(sessions, new Set(["main", "feat-a", "feat-b"]));

  assert.equal(counts.get("/repo"), 3);
  assert.equal(counts.size, 1);
});

test("counts a non-git directory under its cwd", () => {
  const sessions = [session("a", "/plain/dir", undefined)];

  const counts = countRunningSessionsByWorkspace(sessions, new Set(["a"]));

  assert.equal(counts.get("/plain/dir"), 1);
});

test("counts a transient in-memory session when it is reported running", () => {
  const sessions = [session("a", "/repo", "/repo", { transient: true })];

  const counts = countRunningSessionsByWorkspace(sessions, new Set(["a"]));

  assert.equal(counts.get("/repo"), 1);
});
