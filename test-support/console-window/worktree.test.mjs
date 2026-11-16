/**
 * 无控制台进程里的 worktree 列举与增删。
 *
 * 后台实例没有控制台，Windows 上它每启动一个 git 子进程就新分配一个可见窗口并抢走前台
 * 焦点。这条用例对临时夹具仓库走一遍列举、创建与删除，要求过程中没有新窗口。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { consoleWindowCheck, measureNewConsoleWindows, REPO_ROOT } from "../console-window-guard.mjs";

const jiti = createJiti(import.meta.url);
const { createGitEnv } = await jiti.import(path.join(REPO_ROOT, "lib", "git-env.ts"));

const WORKTREE_SCENARIO = path.join(import.meta.dir, "worktree-scenario.mjs");

/** 夹具仓库里的 git 调用同样要剥掉仓库定位变量并隐藏窗口。 */
function git(cwd, args) {
  execFileSync("git", ["-C", cwd, ...args], { env: createGitEnv(), windowsHide: true, encoding: "utf8" });
}

/** 临时夹具仓库：一个已提交的 main 分支，副本目录落在它同级的 `<repo>-worktrees`。 */
function makeRepo(t) {
  const root = path.join(REPO_ROOT, ".tmp", "console-window-worktree", String(process.pid), String(Date.now()));
  fs.mkdirSync(root, { recursive: true });
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(`${root}-worktrees`, { recursive: true, force: true });
  });

  git(root, ["init", "-q"]);
  git(root, ["branch", "-M", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  // 本机可能配了全局钩子与提交签名，临时仓库照用会建不出提交。
  git(root, ["config", "core.hooksPath", ""]);
  git(root, ["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(root, "README.md"), "# fixture\n");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-q", "-m", "init"]);
  return fs.realpathSync.native(root);
}

test("无控制台进程里的 worktree 列举与增删不新建可见控制台窗口", consoleWindowCheck, async (t) => {
  const repo = makeRepo(t);
  const { newWindows, exitCode, timedOut, subjectResult } = await measureNewConsoleWindows({
    mode: "with",
    scenario: WORKTREE_SCENARIO,
    env: { OMPDESK_CONSOLE_SCENARIO_REPO: repo },
    timeoutMs: 60_000,
  });

  assert.equal(timedOut, false, "被测进程没有在时限内退出");
  assert.equal(subjectResult?.ok, true, `场景内部断言失败：${subjectResult?.error ?? "被测进程没有写回结果"}`);
  assert.equal(exitCode, 0, `worktree 列举与增删未跑通：${subjectResult?.error ?? ""}`);
  assert.deepEqual(newWindows, [], `仍然出现可见控制台窗口：${newWindows.map((entry) => entry.title).join("、")}`);
});
