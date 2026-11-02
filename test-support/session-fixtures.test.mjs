/**
 * 会话样本模块的行为测试。
 *
 * 会话经 SessionManager 生成，测试与手工验证共用同一个入口。每个用例自带一份
 * 沙箱：`runtime/agent` 是活动 agent 目录，`agent` 只放样本，`project` 是样本
 * 记录的工作目录。活动目录与样本目录必须分开：铺样本会把标题写进活动目录的
 * history.db，相同的话样本入口就写进了真实目录。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { seedSessions, resetSessionFixtures } = await jiti.import("./session-fixtures.ts");
const { createAgentDirSandbox, restoreAgentDir, switchAgentDir } = await jiti.import("./agent-dir-sandbox.ts");
const { SessionManager } = await jiti.import("@oh-my-pi/pi-coding-agent");
const { getAgentDir, getBaseConfigRoot } = await jiti.import("@oh-my-pi/pi-utils/dirs");

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

/**
 * 建目录符号链接；Windows 建符号链接需要管理员或开发者模式，junction 不需要。
 * 环境不支持建链接时标记用例跳过并返回 false，其他错误照常抛出。
 */
function linkDirectory(t, target, link) {
  try {
    symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch (error) {
    const code = error?.code;
    if (code === "EPERM" || code === "EACCES" || code === "ENOSYS" || code === "ENOTSUP") {
      t.skip("Creating directory symlinks requires additional privileges on this platform");
      return false;
    }
    throw error;
  }
}

function jsonlFiles(dir) {
  return readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
}

function listInfoFor(infos, id) {
  const info = infos.find((candidate) => candidate.id === id);
  assert.ok(info, `listAll 应读回会话 ${id}`);
  return info;
}

/**
 * 等到第一个铺设把 staging 目录写进 sessions。这一刻之后才开始铺第二个场景时，
 * 不排队的话它的清扫会删掉第一个铺设正在写的中间目录。
 */
async function waitForStaging(sessionsDir) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(sessionsDir) && readdirSync(sessionsDir).some((name) => name.startsWith(".staging-"))) {
      return;
    }
    await new Promise((resume) => setTimeout(resume, 5));
  }
  assert.fail("铺设没有在预期时间内产出 staging 目录");
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

test("同一 agentDir 上的并发铺设互不干扰", async (t) => {
  const sandbox = createSandbox(t);
  const sessionsDir = fixturesDir(sandbox.agentDir);
  const options = { agentDir: sandbox.agentDir, cwd: sandbox.cwd };

  // 铺设会清扫整棵目录下的 staging 与备份：不排队时后来者会把先行者正在写的
  // staging 删掉。先让 long 开始铺，等它的 staging 落盘后再铺第二个场景，两个
  // 铺设同时在飞，两边都必须完整落地。
  const long = seedSessions("long", options);
  // 等待期间先挂上失败处理，避免它的拒绝冒成未处理拒绝；Promise.all 仍能看到。
  long.catch(() => {});
  await waitForStaging(sessionsDir);
  const empty = seedSessions("empty", options);
  const [longSessions, emptySessions] = await Promise.all([long, empty]);

  assert.equal(longSessions.length, 1);
  assert.equal(emptySessions.length, 1);
  assert.deepEqual(jsonlFiles(join(sessionsDir, "fixture-long")), [basename(longSessions[0].path)]);
  assert.deepEqual(jsonlFiles(join(sessionsDir, "fixture-empty")), [basename(emptySessions[0].path)]);
  assert.deepEqual(readdirSync(sessionsDir).sort(), ["fixture-empty", "fixture-long"]);
  assert.deepEqual(readdirSync(sandbox.agentDir), ["sessions"], "并发铺设不得留下中间目录");

  sandbox.readFixtures();
  const infos = await SessionManager.listAll();
  assert.equal(infos.length, 2, "两个场景各自只有一条会话");
  assert.equal(listInfoFor(infos, longSessions[0].id).title, TITLE_LONG);
  assert.equal(listInfoFor(infos, emptySessions[0].id).title, TITLE_EMPTY);
});

test("铺样本前清掉替换阶段残留的 .staging- 与 .backup- 目录", async (t) => {
  const sandbox = createSandbox(t);
  const sessionsDir = fixturesDir(sandbox.agentDir);
  await seedSessions("single-turn", { agentDir: sandbox.agentDir, cwd: sandbox.cwd });

  // 模拟替换阶段被杀的进程：staging 在 sessions 下，备份在 agentDir 顶层。
  const scenarioDir = join(sessionsDir, "fixture-single-turn");
  cpSync(scenarioDir, join(sandbox.agentDir, ".backup-fixture-single-turn-killed"), { recursive: true });
  mkdirSync(join(sessionsDir, ".staging-killed"), { recursive: true });

  const [reseeding] = await seedSessions("single-turn", { agentDir: sandbox.agentDir, cwd: sandbox.cwd });

  assert.deepEqual(readdirSync(sessionsDir), ["fixture-single-turn"]);
  assert.deepEqual(readdirSync(sandbox.agentDir), ["sessions"], "残留备份不得留在 agentDir 顶层");
  sandbox.readFixtures();
  const infos = await SessionManager.listAll();
  assert.deepEqual(infos.map((info) => info.id), [reseeding.id], "残留目录不得变成额外会话");
});

test("会话扫描看不到 agentDir 顶层的替换备份", async (t) => {
  const sandbox = createSandbox(t);
  const [seeded] = await seedSessions("single-turn", { agentDir: sandbox.agentDir, cwd: sandbox.cwd });

  // 删除最终失败时留下的备份：位于 sessions 之外，里面的 .jsonl 不在扫描范围。
  cpSync(
    join(fixturesDir(sandbox.agentDir), "fixture-single-turn"),
    join(sandbox.agentDir, `.backup-fixture-single-turn-${randomUUID()}`),
    { recursive: true },
  );

  sandbox.readFixtures();
  const infos = await SessionManager.listAll();
  assert.deepEqual(infos.map((info) => info.id), [seeded.id], "备份不得变成额外会话");
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

test("活动 agent 目录经符号链接指向目标目录时同样拒绝铺样本", async (t) => {
  const sandbox = createSandbox(t);
  const link = join(sandbox.root, "agent-link");
  if (!linkDirectory(t, sandbox.agentDir, link)) return;

  switchAgentDir(link);
  const before = readdirSync(sandbox.agentDir).sort();

  await assert.rejects(
    () => seedSessions("single-turn", { agentDir: sandbox.agentDir, cwd: sandbox.cwd }),
    /活动 agent 目录/,
  );

  assert.deepEqual(readdirSync(sandbox.agentDir).sort(), before, "拒绝时目标目录不得新增文件");
  assert.equal(existsSync(fixturesDir(sandbox.agentDir)), false, "拒绝时不得创建 sessions");
});

test("符号链接下尚未创建的子目录仍按目标目录内部拒绝铺样本", async (t) => {
  const sandbox = createSandbox(t);
  const link = join(sandbox.root, "agent-link");
  if (!linkDirectory(t, sandbox.agentDir, link)) return;

  // 链接存在、叶子不存在：只有把缺失尾段拼回解析后的祖先，才看得出它落在目标之内。
  const nested = join(link, "unbuilt-child");
  const before = switchAgentDir(nested);
  try {
    await assert.rejects(
      () => seedSessions("single-turn", { agentDir: sandbox.agentDir, cwd: sandbox.cwd }),
      /位于目标 agentDir 内部/,
    );
    assert.equal(existsSync(fixturesDir(sandbox.agentDir)), false, "拒绝时不得创建 sessions");
    assert.equal(existsSync(nested), false, "拒绝时不得在符号链接下创建目录");
  } finally {
    restoreAgentDir(before);
  }
});

test("活动 agent 目录位于真实用户配置根之下时拒绝铺样本", async (t) => {
  const sandbox = createSandbox(t);
  // 配置根是「家目录 + PI_CONFIG_DIR」，而 PI_CONFIG_DIR 只能是相对家目录的目录名：
  // 用指回沙箱的相对路径把配置根搬进临时目录，切换活动目录即使落盘也碰不到真实配置根。
  const savedConfigDir = process.env.PI_CONFIG_DIR;
  process.env.PI_CONFIG_DIR = relative(homedir(), join(sandbox.root, "config-root"));
  const configRoot = getBaseConfigRoot();
  // 配置根下确定不存在的子目录：守卫只比较路径，切过去不写任何文件。
  const absent = join(configRoot, `absent-agent-${randomUUID()}`);
  let before;
  try {
    assert.equal(relative(sandbox.root, configRoot), "config-root", "配置根应落在沙箱里");
    assert.equal(existsSync(absent), false, "用例依赖的路径不得事先存在");
    before = switchAgentDir(absent);
    assert.equal(getAgentDir(), absent, "活动目录应切到不存在的子目录");
    await assert.rejects(
      () => seedSessions("single-turn", { agentDir: sandbox.agentDir, cwd: sandbox.cwd }),
      /活动 agent 目录位于真实用户配置根/,
    );
    assert.equal(existsSync(fixturesDir(sandbox.agentDir)), false, "拒绝时不得创建 sessions");
  } finally {
    try {
      if (before) restoreAgentDir(before);
    } finally {
      if (savedConfigDir === undefined) delete process.env.PI_CONFIG_DIR;
      else process.env.PI_CONFIG_DIR = savedConfigDir;
    }
    assert.equal(existsSync(absent), false, "切到不存在的目录不得落盘");
  }
});

test("活动 agent 目录位于目标 agentDir 内部时拒绝铺样本", async (t) => {
  const sandbox = createSandbox(t);
  // 目标目录内部的未建子目录：守卫只比较路径，拒绝时不会在样本树里生成 history.db。
  const nested = join(sandbox.agentDir, "runtime");
  assert.equal(existsSync(nested), false, "用例依赖的路径不得事先存在");
  const before = switchAgentDir(nested);
  try {
    await assert.rejects(
      () => seedSessions("single-turn", { agentDir: sandbox.agentDir, cwd: sandbox.cwd }),
      /内部/,
    );
    assert.equal(existsSync(fixturesDir(sandbox.agentDir)), false, "拒绝时不得创建 sessions");
    assert.equal(existsSync(nested), false, "拒绝时不得在样本树里创建目录");
  } finally {
    restoreAgentDir(before);
  }
});

test("真实用户配置根下的 agentDir 直接拒绝铺样本", async (t) => {
  const sandbox = createSandbox(t);
  // 配置根下确定不存在的子目录：真实的 agent 目录首次运行前为空，条目检查会放行。
  const target = join(getBaseConfigRoot(), `absent-agent-dir-${randomUUID()}`);

  await assert.rejects(
    () => seedSessions("single-turn", { agentDir: target, cwd: sandbox.cwd }),
    /真实用户配置根/,
  );
  assert.equal(existsSync(target), false, "拒绝时不得创建目录");
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
  mkdirSync(join(sandbox.agentDir, ".backup-fixture-empty-killed"), { recursive: true });

  await resetSessionFixtures(sandbox.agentDir);
  assert.equal(existsSync(join(fixturesDir(sandbox.agentDir), "fixture-single-turn")), false);
  assert.equal(existsSync(join(fixturesDir(sandbox.agentDir), "fixture-empty")), false);
  assert.deepEqual(readdirSync(fixturesDir(sandbox.agentDir)), []);
  assert.deepEqual(readdirSync(sandbox.agentDir), ["sessions"], "复位应清掉 agentDir 顶层的替换备份");

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

test("resetSessionFixtures 在活动 agent 目录与目标相同时拒绝", async (t) => {
  const sandbox = createSandbox(t);
  await seedSessions("single-turn", { agentDir: sandbox.agentDir, cwd: sandbox.cwd });
  switchAgentDir(sandbox.agentDir);

  await assert.rejects(() => resetSessionFixtures(sandbox.agentDir), /活动 agent 目录/);
  assert.deepEqual(
    readdirSync(fixturesDir(sandbox.agentDir)),
    ["fixture-single-turn"],
    "拒绝时不得删除样本",
  );
});

test("resetSessionFixtures 拒绝真实用户配置根下的 agentDir，符号链接亦然", async (t) => {
  const sandbox = createSandbox(t);
  // 与铺样本的用例一致：把配置根搬进沙箱，避免复位真的碰到用户配置根。
  const savedConfigDir = process.env.PI_CONFIG_DIR;
  process.env.PI_CONFIG_DIR = relative(homedir(), join(sandbox.root, "config-root"));
  try {
    // 写之前先确认配置根确实落在沙箱里：PI_CONFIG_DIR 没生效或跨盘时
    // getBaseConfigRoot() 会指回真实配置根，victim 就写进了用户数据。
    assert.equal(
      relative(sandbox.root, getBaseConfigRoot()),
      "config-root",
      "配置根应落在沙箱里",
    );
    const realAgentDir = join(getBaseConfigRoot(), "agent");
    const victim = join(realAgentDir, "sessions", "fixture-single-turn", "victim.jsonl");
    mkdirSync(dirname(victim), { recursive: true });
    writeFileSync(victim, "");

    await assert.rejects(() => resetSessionFixtures(realAgentDir), /真实用户配置根/);

    // 指向真实 agent 目录的符号链接：字面路径在沙箱里，只有真实路径露出配置根。
    const link = join(sandbox.root, "agent-link");
    if (linkDirectory(t, realAgentDir, link)) {
      await assert.rejects(() => resetSessionFixtures(link), /真实用户配置根/);
    }

    assert.ok(existsSync(victim), "拒绝时不得删除样本");
  } finally {
    if (savedConfigDir === undefined) delete process.env.PI_CONFIG_DIR;
    else process.env.PI_CONFIG_DIR = savedConfigDir;
  }
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
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(" "));
  try {
    assert.notEqual(getAgentDir(), before.agentDir, "沙箱应把活动目录切到 runtime/agent");
  } finally {
    // 断言失败也要跑完清理：活动目录停在沙箱上会让后续用例级联失败。
    try {
      for (const cleanup of cleanups) cleanup();
    } finally {
      console.warn = originalWarn;
    }
  }

  assert.equal(cleanups.length, 1);
  assert.equal(getAgentDir(), before.agentDir, "清理后应恢复进入沙箱前的活动目录");
  assert.equal(process.env.PI_CODING_AGENT_DIR, before.env);
  assert.equal(existsSync(sandbox.root), false, "清理应删除沙箱目录");
  assert.match(warnings.join("\n"), /beforeRestore/, "清理失败只告警，不抛给用例");
});
