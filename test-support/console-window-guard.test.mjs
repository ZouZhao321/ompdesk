/**
 * 无控制台进程里的子进程窗口判定。
 *
 * 用户症状：后台实例运行期间启动控制台程序会闪出可见窗口并抢走前台焦点。判据是「被测进程
 * 存活期间新增的可见控制台窗口数」。两条用例互为对照：一条必须为 0，一条必须大于 0，
 * 后者证明判定真的能看见窗口——判定失灵时它会失败。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import {
  consoleWindowCheck,
  measureNewConsoleWindows,
  removeWindowTmpRoot,
  REPO_ROOT,
  WINDOW_TMP_ROOT,
} from "./console-window-guard.mjs";

const jiti = createJiti(import.meta.url);
const { createGitEnv } = await jiti.import(path.join(REPO_ROOT, "lib", "git-env.ts"));

const GIT_STATUS_SCENARIO = path.join(import.meta.dir, "console-window", "git-status-scenario.mjs");
const CONTROL_SCENARIO = path.join(import.meta.dir, "console-window", "unhidden-console-scenario.mjs");

/** 夹具仓库里的 git 调用同样要剥掉仓库定位变量并隐藏窗口。 */
function git(cwd, args) {
  execFileSync("git", ["-C", cwd, ...args], { env: createGitEnv(), windowsHide: true, encoding: "utf8" });
}

/** 临时夹具仓库：一个已提交的文件被改动，供状态与 diff 共同使用。 */
function makeFixture(t) {
  const root = path.join(WINDOW_TMP_ROOT, `fixture-${process.pid}-${Date.now()}`);
  fs.mkdirSync(root, { recursive: true });
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    removeWindowTmpRoot();
  });

  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  // 本机可能配了全局钩子与提交签名，临时仓库照用会建不出提交。
  git(root, ["config", "core.hooksPath", ""]);
  git(root, ["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(root, "modified.txt"), "before\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "init"]);
  fs.writeFileSync(path.join(root, "modified.txt"), "before\nafter\n");
  return root;
}

test("反向对照：判定能看见未隐藏的控制台子进程", consoleWindowCheck, async () => {
  const { newWindows, exitCode, timedOut, subjectResult } = await measureNewConsoleWindows({
    mode: "without",
    scenario: CONTROL_SCENARIO,
    env: { OMPDESK_CONSOLE_CONTROL_HIDDEN: "0" },
    timeoutMs: 30_000,
  });

  assert.equal(timedOut, false, "被测进程没有在时限内退出");
  assert.equal(exitCode, 0, `被测进程非零退出：${subjectResult?.error ?? ""}`);
  assert.ok(newWindows.length > 0, "未隐藏的控制台子进程没有被判定看见；判定失灵时通过的正向用例不作数");
});

test("启动入口补上隐藏控制台后，未隐藏的子进程也不再出现可见窗口", consoleWindowCheck, async () => {
  const { newWindows, exitCode, subjectResult } = await measureNewConsoleWindows({
    mode: "with",
    scenario: CONTROL_SCENARIO,
    env: { OMPDESK_CONSOLE_CONTROL_HIDDEN: "1" },
    timeoutMs: 30_000,
  });

  assert.equal(exitCode, 0, `被测进程非零退出：${subjectResult?.error ?? ""}`);
  assert.deepEqual(
    newWindows,
    [],
    `启动入口生效后仍然出现可见控制台窗口：${newWindows.map((entry) => entry.title).join("、")}`,
  );
});

test("无控制台进程里的 git 状态与 diff 不新建可见控制台窗口", consoleWindowCheck, async (t) => {
  const fixture = makeFixture(t);
  const { newWindows, exitCode, timedOut, subjectResult } = await measureNewConsoleWindows({
    mode: "with",
    scenario: GIT_STATUS_SCENARIO,
    env: { OMPDESK_CONSOLE_SCENARIO_CWD: fixture },
    timeoutMs: 60_000,
  });

  assert.equal(timedOut, false, "被测进程没有在时限内退出");
  assert.equal(exitCode, 0, `git 状态与 diff 未跑通：${subjectResult?.error ?? ""}`);
  assert.deepEqual(newWindows, [], `仍然出现可见控制台窗口：${newWindows.map((entry) => entry.title).join("、")}`);
});
