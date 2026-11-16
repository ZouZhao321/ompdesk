/**
 * 无控制台进程里的文件树列举与忽略判定。
 *
 * 用户症状：后台实例列举目录时每启动一个 git 子进程都会闪出可见窗口。这条用例把列举与忽略
 * 判定放进与后台实例同形的无控制台进程，既验证行为本身，也验证不新增可见窗口。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import {
  consoleWindowCheck,
  measureNewConsoleWindows,
  removeWindowTmpRoot,
  REPO_ROOT,
  WINDOW_TMP_ROOT,
} from "../console-window-guard.mjs";

const jiti = createJiti(import.meta.url);
const { createGitEnv } = await jiti.import(path.join(REPO_ROOT, "lib", "git-env.ts"));

const FILE_INDEX_SCENARIO = path.join(import.meta.dir, "file-index-scenario.mjs");

/** 夹具仓库里的 git 调用同样要剥掉仓库定位变量并隐藏窗口。 */
function git(cwd, args) {
  execFileSync("git", ["-C", cwd, ...args], { env: createGitEnv(), windowsHide: true, encoding: "utf8" });
}

/**
 * 临时夹具仓库：一个普通文件、一个被忽略的文件、一个被忽略目录里的文件。
 *
 * 非 git 目录必须落在仓库之外：git 会向上发现 `.tmp` 所属的仓库，落在里面就得不到降级结果。
 */
function makeFixture(t) {
  const root = path.join(WINDOW_TMP_ROOT, `file-index-${process.pid}-${Date.now()}`);
  fs.mkdirSync(root, { recursive: true });
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-file-index-plain-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(plain, { recursive: true, force: true });
    removeWindowTmpRoot();
  });

  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  // 本机可能配了全局钩子与提交签名，临时仓库照用会建不出提交。
  git(root, ["config", "core.hooksPath", ""]);
  git(root, ["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(root, ".gitignore"), "ignored.txt\nignored-dir/\n");
  fs.writeFileSync(path.join(root, "plain.txt"), "plain\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "init"]);
  fs.writeFileSync(path.join(root, "ignored.txt"), "ignored\n");
  fs.mkdirSync(path.join(root, "ignored-dir"));
  fs.writeFileSync(path.join(root, "ignored-dir", "inner.txt"), "inner\n");

  return { root, plain };
}

test("无控制台进程里的文件树列举与忽略判定不新建可见控制台窗口", consoleWindowCheck, async (t) => {
  const { root, plain } = makeFixture(t);
  const { newWindows, exitCode, timedOut, subjectResult } = await measureNewConsoleWindows({
    mode: "with",
    scenario: FILE_INDEX_SCENARIO,
    env: { OMPDESK_CONSOLE_SCENARIO_CWD: root, OMPDESK_CONSOLE_SCENARIO_PLAIN_CWD: plain },
    timeoutMs: 60_000,
  });

  assert.equal(timedOut, false, "被测进程没有在时限内退出");
  assert.equal(exitCode, 0, `文件树列举与忽略判定未跑通：${subjectResult?.error ?? ""}`);
  assert.equal(subjectResult?.ok, true, `场景没有报告成功：${JSON.stringify(subjectResult)}`);
  assert.deepEqual(newWindows, [], `仍然出现可见控制台窗口：${newWindows.map((entry) => entry.title).join("、")}`);
});
