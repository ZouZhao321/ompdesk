import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { summarizeWorkspaceActivity } = await createJiti(import.meta.url).import("./workspace-activity.ts");

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

function activityOf(summary, key) {
	return summary.get(key) ?? { active: 0, waiting: 0, busy: 0 };
}

test("counts running sessions grouped by their workspace key", () => {
	const sessions = [session("a", "/repo", "/repo"), session("b", "/repo", "/repo"), session("c", "/other", "/other")];

	const summary = summarizeWorkspaceActivity(sessions, new Set(["a", "b"]), new Set());

	assert.deepEqual(activityOf(summary, "/repo"), { active: 2, waiting: 0, busy: 2 });
	assert.equal(summary.has("/other"), false);
	assert.equal(summary.size, 1);
});

test("reports a waiting-only session as waiting and busy but not active", () => {
	const sessions = [session("a", "/repo", "/repo")];

	const summary = summarizeWorkspaceActivity(sessions, new Set(), new Set(["a"]));

	assert.deepEqual(activityOf(summary, "/repo"), { active: 0, waiting: 1, busy: 1 });
});

test("counts a session that is running and waiting once as busy", () => {
	const sessions = [session("a", "/repo", "/repo")];

	const summary = summarizeWorkspaceActivity(sessions, new Set(["a"]), new Set(["a"]));

	assert.deepEqual(activityOf(summary, "/repo"), { active: 0, waiting: 1, busy: 1 });
});

test("sums active, waiting and their union per workspace", () => {
	const sessions = [
		session("working", "/repo", "/repo"),
		session("blocked", "/repo", "/repo"),
		session("idle", "/repo", "/repo"),
	];

	const summary = summarizeWorkspaceActivity(sessions, new Set(["working", "blocked"]), new Set(["blocked"]));

	assert.deepEqual(activityOf(summary, "/repo"), { active: 1, waiting: 1, busy: 2 });
	assert.equal(summary.size, 1);
});

test("ignores activity ids that belong to sessions outside the session list", () => {
	const sessions = [session("a", "/repo", "/repo")];

	const summary = summarizeWorkspaceActivity(sessions, new Set(["a", "elsewhere"]), new Set(["gone"]));

	assert.deepEqual(activityOf(summary, "/repo"), { active: 1, waiting: 0, busy: 1 });
	assert.equal(summary.size, 1);
});

test("returns nothing when no session is running or waiting", () => {
	const sessions = [
		session("a", "/repo", "/repo"),
		session("b", "/repo/.worktrees/a", "/repo"),
		session("c", "/plain/dir", undefined),
	];

	const summary = summarizeWorkspaceActivity(sessions, new Set(), new Set());

	assert.equal(summary.size, 0);
});

test("sums several worktrees under one project root", () => {
	const sessions = [
		session("main", "/repo", "/repo"),
		session("feat-a", "/repo/.worktrees/a", "/repo"),
		session("feat-b", "/repo/.worktrees/b", "/repo"),
	];

	const summary = summarizeWorkspaceActivity(sessions, new Set(["main", "feat-a"]), new Set(["feat-b"]));

	assert.deepEqual(activityOf(summary, "/repo"), { active: 2, waiting: 1, busy: 3 });
	assert.equal(summary.size, 1);
});

test("groups a non-git directory under its cwd", () => {
	const sessions = [session("a", "/plain/dir", undefined)];

	const summary = summarizeWorkspaceActivity(sessions, new Set(["a"]), new Set());

	assert.deepEqual(activityOf(summary, "/plain/dir"), { active: 1, waiting: 0, busy: 1 });
});

test("counts a transient in-memory session when it is reported active", () => {
	const sessions = [session("a", "/repo", "/repo", { transient: true })];

	const summary = summarizeWorkspaceActivity(sessions, new Set(), new Set(["a"]));

	assert.deepEqual(activityOf(summary, "/repo"), { active: 0, waiting: 1, busy: 1 });
});
