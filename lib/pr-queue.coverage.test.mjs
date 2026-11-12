import assert from "node:assert/strict";
import test from "node:test";

const { classifyPullRequest } = await import("./pr-queue.ts");

function pullRequest(overrides = {}) {
  return {
    number: 7,
    branch: "feature/queue",
    createdAt: "2026-01-01T00:00:00Z",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    checks: [],
    conflictsWith: [],
    behindCommits: 0,
    unresolvedThreads: 0,
    changedFiles: 3,
    containedIn: null,
    ...overrides,
  };
}

test("reports an unreadable remote branch as a decision the user must make", () => {
  const verdict = classifyPullRequest(pullRequest({ behindCommits: null }), []);

  assert.equal(verdict.ready, false);
  assert.deepEqual(
    verdict.blockers.map((blocker) => blocker.kind),
    ["behind"],
  );
  assert.equal(verdict.blockers[0].needsDecision, true);
  assert.match(verdict.blockers[0].detail, /origin\/feature\/queue/);
});

test("reports a branch merely behind main as an automatic sync", () => {
  const verdict = classifyPullRequest(pullRequest({ behindCommits: 4 }), []);

  assert.deepEqual(
    verdict.blockers.map((blocker) => blocker.kind),
    ["behind"],
  );
  assert.equal(verdict.blockers[0].needsDecision, false);
  assert.match(verdict.blockers[0].detail, /4 个提交/);
});

test("marks a clean pull request ready and keeps its identity", () => {
  const verdict = classifyPullRequest(pullRequest(), []);

  assert.deepEqual(verdict, { number: 7, branch: "feature/queue", blockers: [], ready: true });
});
