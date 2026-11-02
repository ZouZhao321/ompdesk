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
const TITLE_BRANCH = "伪造会话 branch";
const TITLE_SUBAGENT = "伪造会话 subagent";
const TITLE_TOOLS = "伪造会话 tools";
const TITLE_LONG = "伪造会话 long";
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

test("branch 场景从父会话末端分出两条子会话", async (t) => {
  const sandbox = createSandbox(t);
  const seeded = await seedSessions("branch", { agentDir: sandbox.agentDir, cwd: sandbox.cwd });

  assert.equal(seeded.length, 3);
  const [parent, ...children] = seeded;
  const scenarioDir = join(fixturesDir(sandbox.agentDir), "fixture-branch");
  assert.equal(parent.title, TITLE_BRANCH);
  assert.equal(dirname(parent.path), scenarioDir);
  assert.equal(jsonlFiles(scenarioDir).length, 3);
  for (const child of children) {
    assert.equal(child.title, TITLE_BRANCH);
    assert.equal(dirname(child.path), scenarioDir);
  }

  const previous = switchAgentDir(sandbox.agentDir);
  t.after(() => restoreAgentDir(previous));

  const infos = await SessionManager.listAll();
  const parentInfo = listInfoFor(infos, parent.id);
  assert.equal(parentInfo.parentSessionPath, undefined, "父会话自身没有 parentSession");
  assert.equal(parentInfo.messageCount, 2);
  for (const child of children) {
    const info = listInfoFor(infos, child.id);
    assert.equal(resolve(info.parentSessionPath), resolve(parent.path));
    assert.equal(info.messageCount, 3);
  }
});

test("subagent 场景挂一个标题带 Sub 前缀的子会话", async (t) => {
  const sandbox = createSandbox(t);
  const seeded = await seedSessions("subagent", { agentDir: sandbox.agentDir, cwd: sandbox.cwd });

  assert.equal(seeded.length, 2);
  const [parent, child] = seeded;
  assert.equal(parent.title, TITLE_SUBAGENT);
  assert.ok(child.title.startsWith("Sub"), `子会话标题应以 Sub 开头，实际是 ${child.title}`);
  assert.equal(dirname(child.path), join(fixturesDir(sandbox.agentDir), "fixture-subagent"));

  const previous = switchAgentDir(sandbox.agentDir);
  t.after(() => restoreAgentDir(previous));

  const infos = await SessionManager.listAll();
  const info = listInfoFor(infos, child.id);
  assert.equal(resolve(info.parentSessionPath), resolve(parent.path));
  assert.ok(info.title.startsWith("Sub"));
});

test("tools 场景读回思考块、工具调用与结果回填", async (t) => {
  const sandbox = createSandbox(t);
  const [session] = await seedSessions("tools", { agentDir: sandbox.agentDir, cwd: sandbox.cwd });
  assert.equal(session.title, TITLE_TOOLS);

  const manager = await SessionManager.open(session.path, dirname(session.path), undefined, {
    suppressBreadcrumb: true,
  });
  try {
    const messages = manager
      .getEntries()
      .filter((entry) => entry.type === "message")
      .map((entry) => entry.message);
    const assistantMessages = messages.filter((message) => message.role === "assistant");
    const thinkingBlocks = assistantMessages.flatMap((message) =>
      message.content.filter((block) => block.type === "thinking"),
    );
    const toolCalls = assistantMessages.flatMap((message) =>
      message.content.filter((block) => block.type === "toolCall"),
    );
    const toolResults = messages.filter((message) => message.role === "toolResult");

    assert.equal(thinkingBlocks.length, 2, "每轮助手消息都应带一个思考块");
    assert.equal(toolCalls.length, 2, "两轮各有一个工具调用");
    assert.deepEqual(toolCalls.map((call) => call.name), ["read", "bash"]);
    assert.equal(toolResults.length, toolCalls.length, "每个工具调用都应有一条结果回填");
    for (const result of toolResults) {
      const call = toolCalls.find((candidate) => candidate.id === result.toolCallId);
      assert.ok(call, `结果回填应指向已存在的调用 ${result.toolCallId}`);
      assert.equal(result.toolName, call.name);
    }
  } finally {
    await manager.close();
  }
});

test("tools 场景的 messageCount 与读回条目数一致", async (t) => {
  const sandbox = createSandbox(t);
  const [session] = await seedSessions("tools", { agentDir: sandbox.agentDir, cwd: sandbox.cwd });

  const previous = switchAgentDir(sandbox.agentDir);
  t.after(() => restoreAgentDir(previous));

  const info = listInfoFor(await SessionManager.listAll(), session.id);
  const manager = await SessionManager.open(session.path, dirname(session.path), undefined, {
    suppressBreadcrumb: true,
  });
  try {
    const messageEntries = manager.getEntries().filter((entry) => entry.type === "message");
    assert.equal(messageEntries.length, 8);
    assert.equal(info.messageCount, messageEntries.length);
  } finally {
    await manager.close();
  }
});

test("long 场景至少 24 组消息，时间戳严格递增且用量为正", async (t) => {
  const sandbox = createSandbox(t);
  const [session] = await seedSessions("long", { agentDir: sandbox.agentDir, cwd: sandbox.cwd });
  assert.equal(session.title, TITLE_LONG);

  const manager = await SessionManager.open(session.path, dirname(session.path), undefined, {
    suppressBreadcrumb: true,
  });
  try {
    const messages = manager
      .getEntries()
      .filter((entry) => entry.type === "message")
      .map((entry) => entry.message);
    const userMessages = messages.filter((message) => message.role === "user");
    const assistantMessages = messages.filter((message) => message.role === "assistant");

    assert.ok(userMessages.length >= 24, `应有至少 24 组消息，实际 ${userMessages.length}`);
    assert.equal(assistantMessages.length, userMessages.length);
    assert.equal(messages.length, userMessages.length * 2, "用户与助手消息应交替出现");
    messages.forEach((message, index) => {
      assert.equal(message.role, index % 2 === 0 ? "user" : "assistant");
    });

    const step = messages[1].timestamp - messages[0].timestamp;
    assert.ok(step > 0, "时间戳应递增");
    for (let index = 1; index < messages.length; index += 1) {
      assert.ok(
        messages[index].timestamp > messages[index - 1].timestamp,
        `第 ${index} 条消息的时间戳应严格大于前一条`,
      );
      assert.equal(messages[index].timestamp - messages[index - 1].timestamp, step);
    }

    const totalTokens = assistantMessages.map((message) => message.usage.totalTokens);
    assert.ok(
      totalTokens.every((tokens) => tokens > 0),
      `助手消息的 usage.totalTokens 应全为正数，实际 ${totalTokens.join(",")}`,
    );
  } finally {
    await manager.close();
  }
});

test("branch 与 subagent 场景重复铺设不增加文件，也不留下中间目录", async (t) => {
  const sandbox = createSandbox(t);
  const sessionsDir = fixturesDir(sandbox.agentDir);

  for (const [scenario, expected] of [
    ["branch", 3],
    ["subagent", 2],
  ]) {
    const scenarioDir = join(sessionsDir, `fixture-${scenario}`);
    await seedSessions(scenario, { agentDir: sandbox.agentDir, cwd: sandbox.cwd });
    const first = jsonlFiles(scenarioDir);

    await seedSessions(scenario, { agentDir: sandbox.agentDir, cwd: sandbox.cwd });
    const second = jsonlFiles(scenarioDir);

    assert.equal(first.length, expected);
    assert.equal(second.length, expected);
  }

  assert.deepEqual(readdirSync(sessionsDir).sort(), ["fixture-branch", "fixture-subagent"]);
});

test("tools 与 long 场景重复铺设不增加文件，也不留下中间目录", async (t) => {
  const sandbox = createSandbox(t);
  const sessionsDir = fixturesDir(sandbox.agentDir);

  for (const scenario of ["tools", "long"]) {
    const scenarioDir = join(sessionsDir, `fixture-${scenario}`);
    await seedSessions(scenario, { agentDir: sandbox.agentDir, cwd: sandbox.cwd });
    const first = jsonlFiles(scenarioDir);

    await seedSessions(scenario, { agentDir: sandbox.agentDir, cwd: sandbox.cwd });
    const second = jsonlFiles(scenarioDir);

    assert.equal(first.length, 1, `${scenario} 场景应只有一个会话文件`);
    assert.equal(second.length, first.length);
  }

  assert.deepEqual(readdirSync(sessionsDir).sort(), ["fixture-long", "fixture-tools"]);
});

test("新场景同样拒绝带 sessions 以外条目的 agentDir", async (t) => {
  const sandbox = createSandbox(t);
  writeFileSync(join(sandbox.agentDir, "models.yml"), "");

  for (const scenario of ["branch", "subagent", "tools", "long"]) {
    await assert.rejects(
      () => seedSessions(scenario, { agentDir: sandbox.agentDir, cwd: sandbox.cwd }),
      /models\.yml/,
    );
  }
  assert.equal(existsSync(fixturesDir(sandbox.agentDir)), false, "拒绝时不得创建 sessions");
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
