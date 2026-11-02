/**
 * 会话样本模块的行为测试。
 *
 * 会话经 SessionManager 生成，测试与手工验证共用同一个入口。omp 的活动 agent 目录
 * 在文件开头指向进程临时目录，样本目录另用一份，避免写入真实的 ~/.omp/agent。
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { seedSessions, resetSessionFixtures } = await jiti.import("./session-fixtures.ts");
const { SessionManager } = await jiti.import("@oh-my-pi/pi-coding-agent");
const { getAgentDir, setAgentDir, __resetDirsFromEnvForTests } = await jiti.import("@oh-my-pi/pi-utils/dirs");

const TITLE_SINGLE_TURN = "伪造会话 single-turn";
const TITLE_EMPTY = "伪造会话 empty";
const USER_TEXT = "伪造会话 single-turn 的用户消息";

const originalAgentDir = getAgentDir();
const originalAgentDirEnv = process.env.PI_CODING_AGENT_DIR;
const runtimeRoot = mkdtempSync(join(tmpdir(), "ompdesk-session-fixtures-runtime-"));
const runtimeAgentDir = join(runtimeRoot, "agent");
mkdirSync(runtimeAgentDir, { recursive: true });

/** 切换 omp 的活动 agent 目录，返回切换前的值供恢复。 */
function switchAgentDir(dir) {
  const snapshot = { agentDir: getAgentDir(), env: process.env.PI_CODING_AGENT_DIR };
  setAgentDir(dir);
  __resetDirsFromEnvForTests();
  return snapshot;
}

function restoreAgentDir(snapshot) {
  setAgentDir(snapshot.agentDir);
  if (snapshot.env === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = snapshot.env;
  __resetDirsFromEnvForTests();
}

switchAgentDir(runtimeAgentDir);

/** 每个用例一份目录：样本目录与工作目录都在这里，测试结束整体删除。 */
function createSandbox(t) {
  const root = mkdtempSync(join(tmpdir(), "ompdesk-session-fixtures-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, agentDir, cwd };
}

function fixturesDir(agentDir) {
  return join(agentDir, "sessions");
}

function jsonlFiles(dir) {
  return readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
}

function listInfoFor(infos, id) {
  const info = infos.find((candidate) => candidate.id === id);
  assert.ok(info, `listAll 应读回会话 ${id}`);
  return info;
}

test("single-turn 场景生成后能被 SessionManager.listAll 读回", async (t) => {
  const sandbox = createSandbox(t);
  const seeded = await seedSessions("single-turn", { agentDir: sandbox.agentDir, cwd: sandbox.cwd });

  assert.equal(seeded.length, 1);
  const [session] = seeded;
  assert.equal(session.cwd, resolve(sandbox.cwd));
  assert.equal(session.title, TITLE_SINGLE_TURN);
  assert.equal(dirname(session.path), join(resolve(sandbox.agentDir), "sessions", "fixture-single-turn"));
  assert.ok(existsSync(session.path), "样本会话文件应落在场景目录里");

  const previous = switchAgentDir(sandbox.agentDir);
  t.after(() => restoreAgentDir(previous));

  const info = listInfoFor(await SessionManager.listAll(), session.id);
  assert.equal(info.cwd, resolve(sandbox.cwd));
  assert.equal(info.title, TITLE_SINGLE_TURN);
  assert.equal(info.firstMessage, USER_TEXT);
  assert.equal(info.messageCount, 2);
});

test("empty 场景只留下标题，没有消息记录", async (t) => {
  const sandbox = createSandbox(t);
  const [session] = await seedSessions("empty", { agentDir: sandbox.agentDir, cwd: sandbox.cwd });
  assert.equal(session.title, TITLE_EMPTY);

  const previous = switchAgentDir(sandbox.agentDir);
  t.after(() => restoreAgentDir(previous));

  const info = listInfoFor(await SessionManager.listAll(), session.id);
  assert.equal(info.title, TITLE_EMPTY);
  assert.equal(info.messageCount, 0);
});

test("缺失的 agentDir 与非样本目录都会被拒绝", async (t) => {
  const sandbox = createSandbox(t);

  await assert.rejects(() => seedSessions("empty", { cwd: sandbox.cwd }), /agentDir/);
  await assert.rejects(() => seedSessions("empty", { agentDir: "", cwd: sandbox.cwd }), /agentDir/);
  await assert.rejects(
    () => seedSessions("empty", { agentDir: sandbox.agentDir, cwd: sandbox.cwd, timestamp: "not-a-date" }),
    /timestamp/,
  );

  writeFileSync(join(sandbox.agentDir, "agent.db"), "");
  await assert.rejects(() => seedSessions("empty", { agentDir: sandbox.agentDir, cwd: sandbox.cwd }), /agent\.db/);
  assert.equal(existsSync(fixturesDir(sandbox.agentDir)), false, "拒绝时不得创建 sessions");
});

test("重复铺同一场景不增加会话文件，也不留下中间目录", async (t) => {
  const sandbox = createSandbox(t);
  const scenarioDir = join(fixturesDir(sandbox.agentDir), "fixture-single-turn");

  await seedSessions("single-turn", { agentDir: sandbox.agentDir, cwd: sandbox.cwd });
  const first = jsonlFiles(scenarioDir);

  const [repeated] = await seedSessions("single-turn", {
    agentDir: sandbox.agentDir,
    cwd: sandbox.cwd,
    title: "自定义样本标题",
  });
  const second = jsonlFiles(scenarioDir);

  assert.equal(first.length, 1);
  assert.equal(second.length, first.length);
  assert.equal(repeated.title, "自定义样本标题");
  assert.deepEqual(readdirSync(fixturesDir(sandbox.agentDir)), ["fixture-single-turn"]);
});

test("resetSessionFixtures 删除全部场景目录，重复调用不报错", async (t) => {
  const sandbox = createSandbox(t);
  await seedSessions("single-turn", { agentDir: sandbox.agentDir, cwd: sandbox.cwd });
  await seedSessions("empty", { agentDir: sandbox.agentDir, cwd: sandbox.cwd });

  await resetSessionFixtures(sandbox.agentDir);
  assert.equal(existsSync(join(fixturesDir(sandbox.agentDir), "fixture-single-turn")), false);
  assert.equal(existsSync(join(fixturesDir(sandbox.agentDir), "fixture-empty")), false);

  await resetSessionFixtures(sandbox.agentDir);
  await resetSessionFixtures(join(sandbox.root, "missing"));
});

test("恢复 setAgentDir 原值，避免污染后续测试文件", (t) => {
  const sandbox = createSandbox(t);
  const before = getAgentDir();
  const previous = switchAgentDir(sandbox.agentDir);
  assert.equal(getAgentDir(), resolve(sandbox.agentDir));

  restoreAgentDir(previous);
  assert.equal(getAgentDir(), before);

  restoreAgentDir({ agentDir: originalAgentDir, env: originalAgentDirEnv });
  assert.equal(getAgentDir(), originalAgentDir);

  // history.db 的 sqlite 句柄在进程内保持打开，Windows 上删不掉文件本身，只清理其余内容。
  for (const entry of readdirSync(runtimeAgentDir)) {
    if (entry.startsWith("history.db")) continue;
    rmSync(join(runtimeAgentDir, entry), { recursive: true, force: true });
  }
});
