/**
 * 会话样本：用 SessionManager 生成能被 SessionManager.listAll 读回的伪造会话，
 * 测试与手工验证共用同一个入口。
 *
 * 每个场景落在 <agentDir>/sessions/fixture-<scenario>。生成过程先写到同一层的
 * .staging-<随机> 目录，成功后整体替换场景目录：重复铺设不会累积文件，中途失败
 * 也不会留下半个场景；替换阶段被杀的进程留下的 .staging-* 与 .backup-* 在下次
 * 铺设前清掉。
 *
 * branch 与 subagent 场景的父会话先由 SessionManager.create 写出，经 staging 原子
 * 替换进场景目录后再用 SessionManager.open + createBranchedSession 补写子会话：
 * 子会话头部记录的是父文件的最终路径，父文件本身不被改写。
 *
 * 设置标题会写活动 agent 目录的 history.db，因此活动 agent 目录必须与 agentDir
 * 不同：相同就直接拒绝，避免样本入口把索引写进真实目录。调用方要先把活动目录切到
 * 目标之外（例如任务临时目录里的 runtime 目录），不要把 PI_CODING_AGENT_DIR
 * 指向 agentDir。
 */
import { randomUUID } from "crypto";
import type { Dirent } from "fs";
import { mkdir, readdir, rename, rm, stat } from "fs/promises";
import { basename, dirname, join, resolve } from "path";
import { setTimeout as delay } from "timers/promises";
import { SessionManager } from "@oh-my-pi/pi-coding-agent";
import { getAgentDir } from "@oh-my-pi/pi-utils/dirs";

export type SessionScenario = "single-turn" | "empty" | "branch" | "subagent" | "tools" | "long";

export interface SeedOptions {
  agentDir: string;
  cwd: string;
  title?: string;
  /** 消息时间戳，ISO 字符串，默认 `2026-01-01T00:00:00.000Z`。 */
  timestamp?: string;
}

export interface SeededSession {
  id: string;
  path: string;
  title: string;
  cwd: string;
}

const DEFAULT_TIMESTAMP = "2026-01-01T00:00:00.000Z";
const SESSIONS_DIR = "sessions";
const FIXTURE_PREFIX = "fixture-";
const STAGING_PREFIX = ".staging-";
const BACKUP_PREFIX = ".backup-";
// Windows 上关闭写入句柄到改名或删除之间有延迟，rename 与 rm 会短暂报 EPERM/EBUSY/EACCES。
const FS_RETRY_DELAYS_MS = [50, 100, 200, 400, 800];

const SCENARIO_TITLES: Record<SessionScenario, string> = {
  "single-turn": "伪造会话 single-turn",
  empty: "伪造会话 empty",
  branch: "伪造会话 branch",
  subagent: "伪造会话 subagent",
  tools: "伪造会话 tools",
  long: "伪造会话 long",
};

const SINGLE_TURN_USER_TEXT = "伪造会话 single-turn 的用户消息";
const SINGLE_TURN_ASSISTANT_TEXT = "伪造会话 single-turn 的助手回复";
const BRANCH_USER_TEXT = "伪造会话 branch 的用户消息";
const BRANCH_ASSISTANT_TEXT = "伪造会话 branch 的助手回复";
const BRANCH_FORK_USER_TEXTS = [
  "伪造会话 branch 的第一条分支消息",
  "伪造会话 branch 的第二条分支消息",
];
const SUBAGENT_USER_TEXT = "伪造会话 subagent 的用户消息";
const SUBAGENT_ASSISTANT_TEXT = "伪造会话 subagent 的助手回复";
// 子会话标题带 Sub 前缀，侧栏据此折叠子代理会话。
const SUBAGENT_TITLE_PREFIX = "Sub ";
// 子会话消息相对父会话逐条递增，读回时顺序不依赖文件写入时序。
const CHILD_MESSAGE_OFFSET_MS = 1000;

const TOOLS_USER_TEXTS = [
  "伪造会话 tools 的第一轮用户消息：读取 README.md",
  "伪造会话 tools 的第二轮用户消息：列出项目根目录",
];
const TOOLS_THINKING_TEXTS = [
  "伪造会话 tools 的第一轮思考：先确认 README.md 的内容",
  "伪造会话 tools 的第二轮思考：用 bash 列出项目根目录",
];
const TOOLS_REPLY_TEXTS = [
  "伪造会话 tools 的第一轮助手回复：README.md 已读取",
  "伪造会话 tools 的第二轮助手回复：目录已列出",
];
const TOOLS_READ_RESULT_TEXT = "伪造会话 tools 的 read 结果：README.md 的样本内容";
const TOOLS_BASH_RESULT_TEXT = "伪造会话 tools 的 bash 结果：app、components、lib";
// 工具调用、结果回填与收尾回复按固定步长推进，读回后的配对不依赖文件写入时序。
const TOOLS_MESSAGE_STEP_MS = 1000;
const TOOLS_MESSAGES_PER_ROUND = 4;
const TOOLS_CALLS: readonly ToolCallSpec[] = [
  {
    id: "call_fixture_tools_read",
    name: "read",
    arguments: { path: "README.md" },
    resultText: TOOLS_READ_RESULT_TEXT,
  },
  {
    id: "call_fixture_tools_bash",
    name: "bash",
    arguments: { command: "ls" },
    resultText: TOOLS_BASH_RESULT_TEXT,
  },
];
const NO_ASSISTANT_USAGE: AssistantUsage = { input: 0, output: 0 };
const TOOLS_ASSISTANT_USAGE: AssistantUsage = { input: 180, output: 60 };
// 长上下文场景每轮两条消息，助手回合带非零用量，会话地图由这些条目展开。
const LONG_TURN_COUNT = 24;
const LONG_MESSAGE_STEP_MS = 60_000;
const LONG_ASSISTANT_USAGE: AssistantUsage = { input: 2400, output: 800 };

type SessionMessage = Parameters<SessionManager["appendMessage"]>[0];
type AssistantContent = Extract<SessionMessage, { role: "assistant" }>["content"];
type AssistantStopReason = Extract<SessionMessage, { role: "assistant" }>["stopReason"];

interface AssistantUsage {
  input: number;
  output: number;
}

interface ToolCallSpec {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  resultText: string;
}

interface BuiltSession {
  id: string;
  file: string;
  title: string;
  cwd: string;
}

interface ScenarioPlan {
  /** 已写入 staging 的会话，原子替换后整体落到场景目录。 */
  sessions: BuiltSession[];
  /**
   * 原子替换后再补写的会话。子会话的头部要记录父文件的最终路径，所以父会话
   * 发布到场景目录之后才能分叉。
   */
  extend: (scenarioDir: string) => Promise<BuiltSession[]>;
}

export async function seedSessions(
  scenario: SessionScenario,
  options: SeedOptions,
): Promise<SeededSession[]> {
  const agentDir = requireAgentDir(options?.agentDir);
  assertActiveAgentDirSeparate(agentDir);
  if (!Object.hasOwn(SCENARIO_TITLES, scenario)) {
    throw new Error(`session-fixtures: 未知场景 ${String(scenario)}`);
  }

  const title = options.title ?? SCENARIO_TITLES[scenario];
  const messageTime = parseTimestamp(options.timestamp ?? DEFAULT_TIMESTAMP);
  const scenarioDir = join(agentDir, SESSIONS_DIR, `${FIXTURE_PREFIX}${scenario}`);

  await assertFixtureAgentDir(agentDir);
  const sessionsDir = join(agentDir, SESSIONS_DIR);
  await sweepStaleDirectories(sessionsDir);
  await assertFixtureSessionsDir(sessionsDir);
  const stagingDir = join(sessionsDir, `${STAGING_PREFIX}${randomUUID()}`);
  await mkdir(stagingDir, { recursive: true });

  try {
    const plan = await buildScenario(scenario, { cwd: options.cwd, title, messageTime }, stagingDir);
    const children = await replaceDirectory(stagingDir, scenarioDir, () => plan.extend(scenarioDir));
    return [...plan.sessions, ...children].map((session) => ({
      id: session.id,
      path: join(scenarioDir, basename(session.file)),
      title: session.title,
      cwd: session.cwd,
    }));
  } finally {
    // 正常情况下 staging 已被改名，force 让这次清理变成空操作。
    await removeWithRetry(stagingDir);
  }
}

/**
 * 手工入口：删掉 agentDir 下所有样本目录与替换阶段残留的中间目录。
 *
 * 删除前只做只读检查：目录不存在就直接返回，存在时只允许包含 sessions，与
 * seedSessions 的守卫一致，误传真实 agent 目录会被拒绝；检查不创建任何目录。
 */
export async function resetSessionFixtures(agentDir: string): Promise<void> {
  const resolved = requireAgentDir(agentDir);
  const entries = await readAgentDirEntries(resolved);
  if (entries === null) return;
  assertOnlySessions(entries);
  const sessionsDir = join(resolved, SESSIONS_DIR);
  for (const entry of await listSessionDirectories(sessionsDir)) {
    const stale = entry.name.startsWith(STAGING_PREFIX) || entry.name.startsWith(BACKUP_PREFIX);
    if (entry.name.startsWith(FIXTURE_PREFIX) || stale) {
      await removeWithRetry(join(sessionsDir, entry.name));
    }
  }
}

function requireAgentDir(agentDir: string | undefined): string {
  if (typeof agentDir !== "string" || agentDir.trim() === "") {
    throw new Error("session-fixtures: 必须提供非空的 agentDir");
  }
  return resolve(agentDir);
}

/**
 * 设置标题会写活动 agent 目录的 history.db。活动目录与目标 agentDir 相同时，
 * 样本会在真实目录留下索引，所以在写任何文件之前就拒绝。
 */
function assertActiveAgentDirSeparate(agentDir: string): void {
  // Windows 路径大小写不敏感，比较前统一折叠。
  const comparable = (directory: string) => {
    const absolute = resolve(directory);
    return process.platform === "win32" ? absolute.toLowerCase() : absolute;
  };
  if (comparable(getAgentDir()) !== comparable(agentDir)) return;
  throw new Error(
    `session-fixtures: 活动 agent 目录不能与目标 agentDir 相同（${agentDir}）：`
      + "setSessionName 会把标题写进该目录的 history.db。"
      + "铺样本前先把活动目录切到目标之外，例如 setAgentDir(runtimeDir) 后再调用 "
      + "seedSessions(scenario, { agentDir })",
  );
}

function parseTimestamp(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    throw new Error(`session-fixtures: timestamp 不是合法的 ISO 时间：${timestamp}`);
  }
  return parsed;
}

/**
 * 只接受空目录或只有 sessions 的 agentDir：真实的 agent 目录带 agent.db 或
 * models.yml，放行会把样本写进用户数据。
 */
async function assertFixtureAgentDir(agentDir: string): Promise<void> {
  const entries = await readAgentDirEntries(agentDir);
  if (entries === null) {
    await mkdir(agentDir, { recursive: true });
    return;
  }
  assertOnlySessions(entries);
}

/** 只读列出 agentDir 顶层条目；目录不存在返回 null，不创建任何东西。 */
async function readAgentDirEntries(agentDir: string): Promise<string[] | null> {
  try {
    return await readdir(agentDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** 只放行空目录或只有 sessions：带 agent.db、models.yml 的是真实 agent 目录。 */
function assertOnlySessions(entries: readonly string[]): void {
  const unexpected = entries.filter((name) => name !== SESSIONS_DIR);
  if (unexpected.length > 0) {
    throw new Error(
      `session-fixtures: agentDir 只能包含 ${SESSIONS_DIR}，实际还有 ${unexpected.join("、")}`,
    );
  }
}

/**
 * sessions 下的子目录名只允许 fixture-*：真实的 agent 目录在这里按工作目录分桶，
 * 放行会把样本混进用户会话。
 */
async function assertFixtureSessionsDir(sessionsDir: string): Promise<void> {
  const unexpected = (await listSessionDirectories(sessionsDir))
    .filter((entry) => !entry.name.startsWith(FIXTURE_PREFIX))
    .map((entry) => entry.name);
  if (unexpected.length > 0) {
    throw new Error(
      `session-fixtures: agentDir 的 ${SESSIONS_DIR} 只允许 ${FIXTURE_PREFIX}* 目录，`
        + `实际还有 ${unexpected.join("、")}`,
    );
  }
}

async function listSessionDirectories(sessionsDir: string): Promise<Dirent[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(sessionsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries.filter((entry) => entry.isDirectory());
}

/**
 * 进程在替换阶段被杀会留下 .staging-* 或 .backup-* 目录，里面的 .jsonl 会被
 * 会话列表当成额外会话，铺样本前先扫掉。
 */
async function sweepStaleDirectories(sessionsDir: string): Promise<void> {
  for (const entry of await listSessionDirectories(sessionsDir)) {
    if (entry.name.startsWith(STAGING_PREFIX) || entry.name.startsWith(BACKUP_PREFIX)) {
      await removeWithRetry(join(sessionsDir, entry.name));
    }
  }
}

async function buildScenario(
  scenario: SessionScenario,
  options: { cwd: string; title: string; messageTime: number },
  stagingDir: string,
): Promise<ScenarioPlan> {
  switch (scenario) {
    case "single-turn":
      return {
        sessions: [
          await createSession(
            {
              cwd: options.cwd,
              title: options.title,
              messages: [
                userMessage(SINGLE_TURN_USER_TEXT, options.messageTime),
                assistantMessage(SINGLE_TURN_ASSISTANT_TEXT, options.messageTime),
              ],
            },
            stagingDir,
          ),
        ],
        extend: async () => [],
      };
    case "empty":
      return {
        sessions: [await createSession({ cwd: options.cwd, title: options.title, messages: [] }, stagingDir)],
        extend: async () => [],
      };
    case "branch":
      return buildBranchScenario(options, stagingDir);
    case "subagent":
      return buildSubagentScenario(options, stagingDir);
    case "tools":
      return buildToolsScenario(options, stagingDir);
    case "long":
      return buildLongScenario(options, stagingDir);
  }
}

/** 父会话写一轮问答，再从末端分出两条各追加一条用户消息的子会话。 */
async function buildBranchScenario(
  options: { cwd: string; title: string; messageTime: number },
  stagingDir: string,
): Promise<ScenarioPlan> {
  const parent = await createSession(
    {
      cwd: options.cwd,
      title: options.title,
      messages: [
        userMessage(BRANCH_USER_TEXT, options.messageTime),
        assistantMessage(BRANCH_ASSISTANT_TEXT, options.messageTime),
      ],
    },
    stagingDir,
  );

  return {
    sessions: [parent],
    extend: async (scenarioDir) => {
      const published = publishedSession(parent, scenarioDir);
      const children: BuiltSession[] = [];
      for (const [index, text] of BRANCH_FORK_USER_TEXTS.entries()) {
        const messageTime = options.messageTime + (index + 1) * CHILD_MESSAGE_OFFSET_MS;
        children.push(
          await branchSession(
            published,
            { title: null, messageTime, messages: [userMessage(text, messageTime)] },
            scenarioDir,
          ),
        );
      }
      return children;
    },
  };
}

/** 父会话写一轮问答，再挂一个标题带 Sub 前缀的子会话。 */
async function buildSubagentScenario(
  options: { cwd: string; title: string; messageTime: number },
  stagingDir: string,
): Promise<ScenarioPlan> {
  const parent = await createSession(
    {
      cwd: options.cwd,
      title: options.title,
      messages: [
        userMessage(SUBAGENT_USER_TEXT, options.messageTime),
        assistantMessage(SUBAGENT_ASSISTANT_TEXT, options.messageTime),
      ],
    },
    stagingDir,
  );

  return {
    sessions: [parent],
    extend: async (scenarioDir) => [
      await branchSession(
        publishedSession(parent, scenarioDir),
        {
          title: `${SUBAGENT_TITLE_PREFIX}${options.title}`,
          messageTime: options.messageTime + CHILD_MESSAGE_OFFSET_MS,
          messages: [],
        },
        scenarioDir,
      ),
    ],
  };
}

/** 两轮「思考 + 工具调用 + 结果回填 + 文本回复」，第一轮用 read，第二轮用 bash。 */
async function buildToolsScenario(
  options: { cwd: string; title: string; messageTime: number },
  stagingDir: string,
): Promise<ScenarioPlan> {
  const messages: SessionMessage[] = [];

  for (const [round, call] of TOOLS_CALLS.entries()) {
    const start = options.messageTime + round * TOOLS_MESSAGES_PER_ROUND * TOOLS_MESSAGE_STEP_MS;
    messages.push(
      userMessage(TOOLS_USER_TEXTS[round], start),
      assistantMessage(
        [
          { type: "thinking", thinking: TOOLS_THINKING_TEXTS[round] },
          { type: "toolCall", id: call.id, name: call.name, arguments: call.arguments },
        ],
        start + TOOLS_MESSAGE_STEP_MS,
        TOOLS_ASSISTANT_USAGE,
        "toolUse",
      ),
      toolResultMessage(call, call.resultText, start + 2 * TOOLS_MESSAGE_STEP_MS),
      assistantMessage(TOOLS_REPLY_TEXTS[round], start + 3 * TOOLS_MESSAGE_STEP_MS, TOOLS_ASSISTANT_USAGE),
    );
  }

  return {
    sessions: [await createSession({ cwd: options.cwd, title: options.title, messages }, stagingDir)],
    extend: async () => [],
  };
}

/** 24 轮问答交替出现，时间戳按固定步长递增，助手回合带非零用量。 */
async function buildLongScenario(
  options: { cwd: string; title: string; messageTime: number },
  stagingDir: string,
): Promise<ScenarioPlan> {
  const messages: SessionMessage[] = [];
  for (let turn = 0; turn < LONG_TURN_COUNT; turn++) {
    const userTime = options.messageTime + turn * 2 * LONG_MESSAGE_STEP_MS;
    messages.push(
      userMessage(`伪造会话 long 的第 ${turn + 1} 轮用户消息`, userTime),
      assistantMessage(
        `伪造会话 long 的第 ${turn + 1} 轮助手回复`,
        userTime + LONG_MESSAGE_STEP_MS,
        LONG_ASSISTANT_USAGE,
      ),
    );
  }

  return {
    sessions: [await createSession({ cwd: options.cwd, title: options.title, messages }, stagingDir)],
    extend: async () => [],
  };
}

function publishedSession(session: BuiltSession, scenarioDir: string): BuiltSession {
  return { ...session, file: join(scenarioDir, basename(session.file)) };
}

async function createSession(
  options: { cwd: string; title: string; messages: SessionMessage[] },
  stagingDir: string,
): Promise<BuiltSession> {
  const manager = SessionManager.create(options.cwd, stagingDir);
  try {
    for (const message of options.messages) manager.appendMessage(message);
    await manager.setSessionName(options.title, "user");
    // 只有标题的会话不会因消息而落盘，显式写一次。
    await manager.ensureOnDisk();
    await manager.flush();
    return snapshotSession(manager, options.title);
  } finally {
    await manager.close();
  }
}

/**
 * 从父会话当前末端派生子会话。createBranchedSession 会把管理器本身切到新文件，
 * 所以每条子会话都重新打开父文件；父文件保持原样。
 */
async function branchSession(
  parent: BuiltSession,
  options: { title: string | null; messageTime: number; messages: SessionMessage[] },
  sessionDir: string,
): Promise<BuiltSession> {
  const manager = await SessionManager.open(parent.file, sessionDir, undefined, { suppressBreadcrumb: true });
  try {
    const leafId = manager.getLeafId();
    if (!leafId) {
      throw new Error("session-fixtures: 父会话没有可分支的末端");
    }
    const branchedFile = manager.createBranchedSession(leafId);
    if (!branchedFile) {
      throw new Error("session-fixtures: createBranchedSession 没有生成子会话文件");
    }
    for (const message of options.messages) manager.appendMessage(message);
    if (options.title) await manager.setSessionName(options.title, "user");
    await manager.flush();
    return snapshotSession(manager, options.title ?? parent.title);
  } finally {
    await manager.close();
  }
}

function snapshotSession(manager: SessionManager, fallbackTitle: string): BuiltSession {
  const file = manager.getSessionFile();
  if (!file) {
    throw new Error("session-fixtures: 会话文件没有落盘");
  }
  return {
    id: manager.getSessionId(),
    file,
    title: manager.getSessionName() ?? fallbackTitle,
    cwd: manager.getCwd(),
  };
}

function userMessage(text: string, timestamp: number): SessionMessage {
  return { role: "user", content: text, timestamp };
}

/** 纯文本走字符串形式，思考块与工具调用直接传内容块数组。 */
function assistantMessage(
  content: string | AssistantContent,
  timestamp: number,
  usage: AssistantUsage = NO_ASSISTANT_USAGE,
  stopReason: AssistantStopReason = "stop",
): SessionMessage {
  return {
    role: "assistant",
    content: typeof content === "string" ? [{ type: "text", text: content }] : content,
    api: "fixture",
    provider: "fixture",
    model: "fixture",
    usage: {
      input: usage.input,
      output: usage.output,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: usage.input + usage.output,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp,
  };
}

function toolResultMessage(call: ToolCallSpec, text: string, timestamp: number): SessionMessage {
  return {
    role: "toolResult",
    toolCallId: call.id,
    toolName: call.name,
    content: [{ type: "text", text }],
    isError: false,
    timestamp,
  };
}

/**
 * 用 staging 目录整体替换场景目录，替换后在同一目录补写会话；任一步失败都删掉
 * 新目录并恢复原场景。
 *
 * 备份与 staging 同层，并真正以 .backup- 开头：这样清扫与 fixture-* 守卫都能
 * 覆盖替换阶段被杀的进程留下的备份。
 */
async function replaceDirectory<T>(
  stagingDir: string,
  targetDir: string,
  finish: () => Promise<T>,
): Promise<T> {
  const backupDir = join(dirname(targetDir), `${BACKUP_PREFIX}${basename(targetDir)}-${randomUUID()}`);
  const replaceExisting = await pathExists(targetDir);
  if (replaceExisting) {
    await renameWithRetry(targetDir, backupDir);
  }

  let result: T;
  try {
    await renameWithRetry(stagingDir, targetDir);
    result = await finish();
  } catch (error) {
    // 回滚删不掉新目录时用警告保底，不让清理错误盖掉原始错误，也不跳过备份恢复。
    try {
      await removeWithRetry(targetDir);
    } catch (cleanupError) {
      console.warn(`session-fixtures: 回滚删除 ${targetDir} 失败`, cleanupError);
    }
    if (replaceExisting) {
      // 新目录删不掉时备份回不去（ENOTEMPTY/EPERM），这里同样只告警：
      // 恢复失败不能用它自己的错误替换调用方要看的原始错误。
      try {
        await renameWithRetry(backupDir, targetDir);
      } catch (restoreError) {
        console.warn(`session-fixtures: 恢复备份 ${backupDir} 失败`, restoreError);
      }
    }
    throw error;
  }

  if (replaceExisting) {
    try {
      await removeWithRetry(backupDir);
    } catch (error) {
      // 备份删不掉不影响已铺好的场景；残留的 .backup-* 会被列表当成额外会话，
      // 交给下次清扫或 resetSessionFixtures 处理，这里只记录，不翻转成功结果。
      console.warn(`session-fixtures: 删除备份 ${backupDir} 失败`, error);
    }
  }
  return result;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  await retryWhileBusy(() => rename(from, to));
}

/** 删除目录同样会在 Windows 上撞到 EPERM/EBUSY，与改名共用一套重试。 */
async function removeWithRetry(target: string): Promise<void> {
  await retryWhileBusy(() => rm(target, { recursive: true, force: true }));
}

async function retryWhileBusy<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const retryable = code === "EPERM" || code === "EBUSY" || code === "EACCES";
      if (!retryable || attempt >= FS_RETRY_DELAYS_MS.length) {
        throw error;
      }
      await delay(FS_RETRY_DELAYS_MS[attempt]);
    }
  }
}
