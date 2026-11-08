import assert from "node:assert/strict";
import test from "node:test";
import {
	classifyPullRequest,
	collapseContained,
	orderForMerge,
} from "./pr-queue.ts";

const REQUIRED = ["Verify build", "Lint changed files", "Commit titles"];

function pullRequest(overrides) {
	return {
		number: 1,
		branch: "feat/example",
		createdAt: "2026-11-01T00:00:00Z",
		mergeable: "MERGEABLE",
		mergeStateStatus: "CLEAN",
		checks: REQUIRED.map((name) => ({ name, conclusion: "SUCCESS" })),
		conflictsWith: [],
		behindCommits: 0,
		unresolvedThreads: 0,
		changedFiles: 3,
		containedIn: null,
		...overrides,
	};
}

test("检查齐全、最新、无冲突时判为就绪", () => {
	const verdict = classifyPullRequest(pullRequest(), REQUIRED);

	assert.equal(verdict.ready, true);
	assert.deepEqual(verdict.blockers, []);
});

test("分支缺少必需检查时列出具体项，并标明不需人决策", () => {
	const verdict = classifyPullRequest(
		pullRequest({ checks: [{ name: "Verify build", conclusion: "SUCCESS" }] }),
		REQUIRED,
	);

	const blocker = verdict.blockers.find((item) => item.kind === "missing-checks");
	assert.ok(blocker);
	assert.match(blocker.detail, /Lint changed files/);
	assert.match(blocker.detail, /Commit titles/);
	assert.equal(blocker.detail.includes("Verify build"), false);
	assert.equal(blocker.needsDecision, false);
});

test("与 main 的提交差与冲突分支各自成为一条阻塞", () => {
	const verdict = classifyPullRequest(
		pullRequest({
			behindCommits: 8,
			mergeable: "CONFLICTING",
			mergeStateStatus: "DIRTY",
			conflictsWith: ["feat/other"],
		}),
		REQUIRED,
	);

	assert.deepEqual(
		verdict.blockers.map((item) => item.kind),
		["behind", "conflict"],
	);
	assert.match(verdict.blockers[1].detail, /feat\/other/);
	assert.equal(verdict.ready, false);
});

test("未解决的讨论与失败的检查要人决策，其他阻塞不要", () => {
	const verdict = classifyPullRequest(
		pullRequest({
			behindCommits: 2,
			unresolvedThreads: 3,
			checks: [
				{ name: "Verify build", conclusion: "FAILURE" },
				{ name: "Lint changed files", conclusion: "SUCCESS" },
				{ name: "Commit titles", conclusion: "SKIPPED" },
			],
		}),
		REQUIRED,
	);

	const decision = verdict.blockers.filter((item) => item.needsDecision);
	assert.deepEqual(
		decision.map((item) => item.kind),
		["failing-check", "discussion"],
	);
	assert.match(decision[0].detail, /Verify build/);
	assert.equal(
		verdict.blockers.find((item) => item.kind === "behind").needsDecision,
		false,
	);
});

test("同一批提交分成多个 PR 时只留最上面那个", () => {
	const prs = [
		pullRequest({ number: 10, branch: "feat/a", containedIn: 12 }),
		pullRequest({ number: 11, branch: "feat/b", containedIn: 12 }),
		pullRequest({ number: 12, branch: "feat/c" }),
		pullRequest({ number: 13, branch: "feat/d" }),
	];

	const { groups, standalone } = collapseContained(prs);

	assert.deepEqual(groups, [{ tip: 12, subset: [10, 11] }]);
	assert.deepEqual(standalone, [13]);
});

test("包含关系按传递闭包归到最顶层", () => {
	const prs = [
		pullRequest({ number: 20, branch: "feat/a", containedIn: 21 }),
		pullRequest({ number: 21, branch: "feat/b", containedIn: 22 }),
		pullRequest({ number: 22, branch: "feat/c" }),
	];

	assert.deepEqual(collapseContained(prs).groups, [{ tip: 22, subset: [20, 21] }]);
});

test("指向已关闭 PR 的包含关系不算数", () => {
	const prs = [
		pullRequest({ number: 30, branch: "feat/a", containedIn: 99 }),
		pullRequest({ number: 31, branch: "feat/b" }),
	];

	const { groups, standalone } = collapseContained(prs);

	assert.deepEqual(groups, []);
	assert.deepEqual(standalone, [30, 31]);
});

test("合并顺序先走冲突少、改动小的", () => {
	const prs = [
		pullRequest({ number: 40, branch: "feat/a", conflictsWith: ["b", "c"], changedFiles: 2 }),
		pullRequest({ number: 41, branch: "feat/b", changedFiles: 9 }),
		pullRequest({ number: 42, branch: "feat/c", changedFiles: 1 }),
	];

	assert.deepEqual(orderForMerge(prs), [42, 41, 40]);
});

test("冲突数与改动量都相同时按创建时间先后", () => {
	const prs = [
		pullRequest({ number: 50, branch: "feat/a", createdAt: "2026-11-03T00:00:00Z" }),
		pullRequest({ number: 51, branch: "feat/b", createdAt: "2026-11-02T00:00:00Z" }),
	];

	assert.deepEqual(orderForMerge(prs), [51, 50]);
});
