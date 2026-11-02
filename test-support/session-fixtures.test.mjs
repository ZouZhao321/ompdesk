/**
 * 会话样本模块的行为测试。
 *
 * 会话经 SessionManager 生成，测试与手工验证共用同一个入口。每个用例自带一份
 * 沙箱：`runtime/agent` 是活动 agent 目录，`agent` 只放样本，`project` 是样本
 * 记录的工作目录。活动目录与样本目录必须分开：铺样本会把标题写进活动目录的
 * history.db，相同的话样本入口就写进了真实目录。
 */
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { seedSessions, resetSessionFixtures } = await jiti.import("./session-fixtures.ts");
const { createAgentDirSandbox, restoreAgentDir, switchAgentDir } = await jiti.import("./agent-dir-sandbox.ts");
const { SessionManager } = await jiti.import("@oh-my-pi/pi-coding-agent");
const { getAgentDir } = await jiti.import("@oh-my-pi/pi-utils/dirs");

const TITLE_SINGLE_TURN = "伪造会话 single-turn";
const TITLE_EMPTY = "伪造会话 empty";
const TITLE_BRANCH = "伪造会话 branch";
const TITLE_SUBAGENT = "伪造会话 subagent";
const TITLE_TOOLS = "伪造会话 tools";
const TITLE_LONG = "伪造会话 long";
const USER_TEXT = "伪造会话 single-turn 的用户消息";

/**
 * 每个用例一份目录：活动目录、样本目录与工作目录各自独立，测试结束整体删除。
 */
function createSandbox(t) {
  const sandbox = createAgentDirSandbox(t, {
    prefix: "ompdesk-session-fixtures-",
    dirs: ["agent", "project"],
  });
  const agentDir = join(sandbox.root, "agent");
  return {
    root: sandbox.root,
    agentDir,
    cwd: join(sandbox.root, "project"),
    /** 把活动 agent 目录切到样本目录，之后的 SessionManager.listAll 才扫描样本。 */
    readFixtures() {
      switchAgentDir(agentDir);
    },
  };
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
  assert.deepEqual(readdirSync(sandbox.agentDir), ["sessions"], "铺样本只动样本目录，不碰 agentDir 顶层");

  sandbox.readFixtures();

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

  sandbox.readFixtures();

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

  sandbox.readFixtures();

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

  sandbox.readFixtures();

  const infos = await SessionManager.listAll();
  const info = listInfoFor(infos, child.id);
  assert.equal(resolve(info.parentSessionPath), resolve(parent.path));
  assert.ok(info.title.startsWith("Sub"));
});

test("subagent 场景用 listAll 读回父与子两条会话", async (t) => {
  const sandbox = createSandbox(t);
  const seeded = await seedSessions("subagent", { agentDir: sandbox.agentDir, cwd: sandbox.cwd });

  sandbox.readFixtures();
  const infos = await SessionManager.listAll();

  assert.deepEqual(
    infos.map((info) => info.id).sort(),
    seeded.map((session) => session.id).sort(),
    "listAll 应只读回父会话与子会话",
  );
  const parentInfo = listInfoFor(infos, seeded[0].id);
  const childInfo = listInfoFor(infos, seeded[1].id);
  assert.equal(parentInfo.parentSessionPath, undefined, "父会话自身没有 parentSession");
  assert.equal(resolve(childInfo.parentSessionPath), resolve(seeded[0].path));
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

  sandbox.readFixtures();

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

test("铺样本前清掉替换阶段残留的 .staging- 与 .backup- 目录", async (t) => {
  const sandbox = createSandbox(t);
  const sessionsDir = fixturesDir(sandbox.agentDir);
  await seedSessions("single-turn", { agentDir: sandbox.agentDir, cwd: sandbox.cwd });

  // 模拟替换阶段被杀的进程：备份与 staging 都在 sessions 同层，备份名以 .backup- 开头。
  const scenarioDir = join(sessionsDir, "fixture-single-turn");
  cpSync(scenarioDir, join(sessionsDir, ".backup-fixture-single-turn-killed"), { recursive: true });
  mkdirSync(join(sessionsDir, ".staging-killed"), { recursive: true });

  const [reseeding] = await seedSessions("single-turn", { agentDir: sandbox.agentDir, cwd: sandbox.cwd });

  assert.deepEqual(readdirSync(sessionsDir), ["fixture-single-turn"]);
  sandbox.readFixtures();
  const infos = await SessionManager.listAll();
  assert.deepEqual(infos.map((info) => info.id), [reseeding.id], "残留目录不得变成额外会话");
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

test("sessions 下出现非 fixture 目录时拒绝铺样本", async (t) => {
  const sandbox = createSandbox(t);
  const sessionsDir = fixturesDir(sandbox.agentDir);
  mkdirSync(join(sessionsDir, "C--Users-alex-project"), { recursive: true });

  await assert.rejects(
    () => seedSessions("single-turn", { agentDir: sandbox.agentDir, cwd: sandbox.cwd }),
    /只允许 fixture-/,
  );
  assert.deepEqual(readdirSync(sessionsDir), ["C--Users-alex-project"]);
});

test("活动 agent 目录与目标 agentDir 相同时拒绝铺样本", async (t) => {
  const sandbox = createSandbox(t);
  switchAgentDir(sandbox.agentDir);
  const before = readdirSync(sandbox.agentDir).sort();

  await assert.rejects(
    () => seedSessions("single-turn", { agentDir: sandbox.agentDir, cwd: sandbox.cwd }),
    /活动 agent 目录/,
  );

  assert.deepEqual(readdirSync(sandbox.agentDir).sort(), before, "拒绝时目标目录不得新增文件");
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

test("resetSessionFixtures 删除全部场景目录与中间目录，重复调用不报错", async (t) => {
  const sandbox = createSandbox(t);
  await seedSessions("single-turn", { agentDir: sandbox.agentDir, cwd: sandbox.cwd });
  await seedSessions("empty", { agentDir: sandbox.agentDir, cwd: sandbox.cwd });
  mkdirSync(join(fixturesDir(sandbox.agentDir), ".backup-killed"), { recursive: true });

  await resetSessionFixtures(sandbox.agentDir);
  assert.equal(existsSync(join(fixturesDir(sandbox.agentDir), "fixture-single-turn")), false);
  assert.equal(existsSync(join(fixturesDir(sandbox.agentDir), "fixture-empty")), false);
  assert.deepEqual(readdirSync(fixturesDir(sandbox.agentDir)), []);

  await resetSessionFixtures(sandbox.agentDir);
  const missing = join(sandbox.root, "missing");
  await resetSessionFixtures(missing);
  assert.equal(existsSync(missing), false, "缺失目录不得被创建");
});

test("resetSessionFixtures 拒绝带 sessions 以外条目的 agentDir", async (t) => {
  const sandbox = createSandbox(t);
  await seedSessions("single-turn", { agentDir: sandbox.agentDir, cwd: sandbox.cwd });
  writeFileSync(join(sandbox.agentDir, "agent.db"), "");

  await assert.rejects(() => resetSessionFixtures(sandbox.agentDir), /agent\.db/);
  assert.deepEqual(
    readdirSync(fixturesDir(sandbox.agentDir)),
    ["fixture-single-turn"],
    "拒绝时不得删除样本",
  );
});

test("用例自己切换活动 agent 目录，结束后恢复原值", (t) => {
  const before = { agentDir: getAgentDir(), env: process.env.PI_CODING_AGENT_DIR };
  createSandbox(t);

  assert.notEqual(getAgentDir(), before.agentDir, "沙箱应把活动目录切到 runtime/agent");

  restoreAgentDir(before);
  assert.equal(getAgentDir(), before.agentDir);
  assert.equal(process.env.PI_CODING_AGENT_DIR, before.env);
});

test("beforeRestore 抛错时仍恢复活动目录并删除沙箱", () => {
  const before = { agentDir: getAgentDir(), env: process.env.PI_CODING_AGENT_DIR };
  const cleanups = [];
  const sandbox = createAgentDirSandbox(
    { after: (callback) => cleanups.push(callback) },
    {
      prefix: "ompdesk-sandbox-cleanup-",
      dirs: [],
      beforeRestore() {
        throw new Error("beforeRestore 故意抛错");
      },
    },
  );
  assert.notEqual(getAgentDir(), before.agentDir, "沙箱应把活动目录切到 runtime/agent");

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(" "));
  try {
    for (const cleanup of cleanups) cleanup();
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(cleanups.length, 1);
  assert.equal(getAgentDir(), before.agentDir, "清理后应恢复进入沙箱前的活动目录");
  assert.equal(process.env.PI_CODING_AGENT_DIR, before.env);
  assert.equal(existsSync(sandbox.root), false, "清理应删除沙箱目录");
  assert.match(warnings.join("\n"), /beforeRestore/, "清理失败只告警，不抛给用例");
});
