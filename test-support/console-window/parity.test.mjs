/**
 * 有控制台与无控制台两份快照必须一致。
 *
 * 两种模式的差别只有一个：服务启动入口有没有给宿主补上隐藏控制台。命令的输出、退出码与
 * 返回结构都不得因此改变；一旦改变，说明隐藏窗口影响了命令语义。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { consoleWindowCheck, measureNewConsoleWindows, REPO_ROOT, WINDOW_TMP_ROOT } from "../console-window-guard.mjs";

const jiti = createJiti(import.meta.url);
const { createGitEnv } = await jiti.import(path.join(REPO_ROOT, "lib", "git-env.ts"));

const PARITY_SCENARIO = path.join(import.meta.dir, "parity-scenario.mjs");

function git(cwd, args) {
  execFileSync("git", ["-C", cwd, ...args], { env: createGitEnv(), windowsHide: true, encoding: "utf8" });
}

/** 夹具：一个已提交的文件被改动，另有被忽略与未被忽略的文件各一个。 */
function makeFixture(t) {
  const root = path.join(WINDOW_TMP_ROOT, "parity", String(process.pid), String(Date.now()));
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  git(root, ["config", "core.hooksPath", ""]);
  git(root, ["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(root, ".gitignore"), "ignored.txt\n");
  fs.writeFileSync(path.join(root, "modified.txt"), "before\n");
  fs.writeFileSync(path.join(root, "plain.txt"), "plain\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "init"]);
  fs.writeFileSync(path.join(root, "modified.txt"), "before\nafter\n");
  fs.writeFileSync(path.join(root, "ignored.txt"), "ignored\n");
  return root;
}

async function runOnce({ mode, fixture, snapshotFile }) {
  const result = await measureNewConsoleWindows({
    mode,
    scenario: PARITY_SCENARIO,
    env: { OMPDESK_CONSOLE_SCENARIO_CWD: fixture, OMPDESK_PARITY_SNAPSHOT: snapshotFile },
    timeoutMs: 120_000,
  });
  return {
    ...result,
    snapshot: fs.existsSync(snapshotFile) ? JSON.parse(fs.readFileSync(snapshotFile, "utf8")) : null,
  };
}

test("有控制台与无控制台两种模式下命令结果一致", consoleWindowCheck, async (t) => {
  const fixture = makeFixture(t);
  const workDir = path.join(WINDOW_TMP_ROOT, "parity-snapshots", String(process.pid));
  fs.mkdirSync(workDir, { recursive: true });
  t.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const withFile = path.join(workDir, "with.json");
  const withoutFile = path.join(workDir, "without.json");

  const withConsole = await runOnce({ mode: "with", fixture, snapshotFile: withFile });
  const withoutConsole = await runOnce({ mode: "without", fixture, snapshotFile: withoutFile });

  assert.equal(withConsole.timedOut, false, "带启动入口的一次没有在时限内退出");
  assert.equal(withoutConsole.timedOut, false, "不带启动入口的一次没有在时限内退出");
  assert.equal(withConsole.exitCode, 0, `带启动入口的一次失败：${withConsole.subjectResult?.error ?? ""}`);
  assert.equal(withoutConsole.exitCode, 0, `不带启动入口的一次失败：${withoutConsole.subjectResult?.error ?? ""}`);
  assert.ok(withConsole.snapshot, "带启动入口的一次没有写出快照");
  assert.ok(withoutConsole.snapshot, "不带启动入口的一次没有写出快照");
  assert.deepEqual(withConsole.snapshot, withoutConsole.snapshot, "两种模式下命令结果不一致");
  assert.deepEqual(
    withConsole.newWindows,
    [],
    `带启动入口时出现可见控制台窗口：${withConsole.newWindows.map((entry) => entry.title).join("、")}`,
  );
});
