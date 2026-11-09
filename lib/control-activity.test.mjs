import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { groupSessionActivity } = await createJiti(import.meta.url).import("./control-activity.ts");

function session(id, projectRoot, cwd = projectRoot) {
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd,
    projectRoot,
    created: "",
    modified: "",
    messageCount: 0,
    firstMessage: "",
  };
}

test("会话按项目归组，只有运行时持有的会话参与计数", () => {
  const activity = groupSessionActivity(
    [session("a", "/work/one"), session("b", "/work/one"), session("c", "/work/two")],
    ["a"],
    [],
  );

  assert.equal(activity.running, 1);
  assert.deepEqual(activity.projects, [
    { path: "/work/one", sessions: 2, running: 1, waiting: 0 },
    { path: "/work/two", sessions: 1, running: 0, waiting: 0 },
  ]);
});

test("等待回答的项目排在只是空闲的项目之前", () => {
  const activity = groupSessionActivity(
    [session("idle", "/work/idle"), session("waiting", "/work/waiting")],
    [],
    ["waiting"],
  );

  assert.deepEqual(
    activity.projects.map((project) => project.path),
    ["/work/waiting", "/work/idle"],
  );
  assert.equal(activity.projects[0].waiting, 1);
});

test("工作副本的会话归到所属主仓库，缺失时退回会话目录", () => {
  const worktree = session("w", "/repo/main", "/repo/main/.worktrees/branch");
  const bare = { ...session("n", undefined, "/plain/dir") };
  delete bare.projectRoot;

  const activity = groupSessionActivity([worktree, bare], [], []);
  assert.deepEqual(
    activity.projects.map((project) => project.path),
    ["/plain/dir", "/repo/main"],
  );
});

test("同一会话既在运行又在等待时，两个计数各自累加，不互斥", () => {
  const activity = groupSessionActivity([session("both", "/work/a")], ["both"], ["both"]);
  assert.deepEqual(activity.projects, [{ path: "/work/a", sessions: 1, running: 1, waiting: 1 }]);
  assert.equal(activity.running, 1);
  assert.equal(activity.waiting, 1);
});
test("没有会话时不编造项目", () => {
  assert.deepEqual(groupSessionActivity([], [], []), { running: 0, waiting: 0, projects: [] });
});
