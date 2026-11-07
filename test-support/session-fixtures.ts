/**
 * 会话样本：用 SessionManager 生成能被 SessionManager.listAll 读回的伪造会话，
 * 测试与手工验证共用同一个入口。
 *
 * 每个场景落在 <agentDir>/sessions/fixture-<scenario>。生成过程先写到同一层的
 * .staging-<随机> 目录，成功后整体替换场景目录：重复铺设不会累积文件，中途失败
 * 也不会留下半个场景。被替换的旧场景改名到 <agentDir> 顶层的 .backup-<随机>
 * 目录：它在 sessions 之外，删不掉也不会被会话列表当成额外会话。替换阶段被杀的
 * 进程留下的 .staging-* 与 .backup-* 在下次铺设与复位前清掉。
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
import { basename, join, resolve } from "path";
import { setTimeout as delay } from "timers/promises";
import { SessionManager } from "@oh-my-pi/pi-coding-agent";
import { getAgentDir, getBaseConfigRoot, relativePathWithinNormalizedRoot } from "@oh-my-pi/pi-utils/dirs";
import { comparableDirectory } from "./path-compare";

export type SessionScenario =
  | "single-turn"
  | "empty"
  | "branch"
  | "subagent"
  | "tools"
  | "long"
  | "skill-command";

export interface SeedOptions {
  agentDir: string;
  cwd: string;
  title?: string;
  /** 消息时间戳，ISO 字符串，默认 `2026-01-01T00:00:00.000Z`。 */
  timestamp?: string;
  /**
   * staging 已建好、样本还没开始写时调用，用于并发用例的确定性握手：这一刻锁已
   * 持有，正好覆盖「后来者若清扫整棵目录就会删掉先行者中间目录」的窗口。钩子
   * 阻塞时铺设继续持有锁。
   */
  onStagingReady?: () => void | Promise<void>;
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
// 备份落在 agentDir 顶层而不是 sessions 里：删除失败也不会留下会被会话扫描读到的
// .jsonl，只有我们自己的 fixture-* 备份会被守卫与清扫识别。
const BACKUP_PREFIX = ".backup-";
const FIXTURE_BACKUP_PREFIX = `${BACKUP_PREFIX}${FIXTURE_PREFIX}`;
// Windows 上关闭写入句柄到改名或删除之间有延迟，rename 与 rm 会短暂报这些错误：
// EPERM/EBUSY/EACCES 来自句柄竞争，ENOTEMPTY 来自递归删除期间目录又被写入，
// EMFILE/ENFILE 来自瞬时句柄耗尽。都按同一套延迟重试。
const FS_RETRYABLE_CODES: Record<string, true> = {
  EPERM: true,
  EBUSY: true,
  EACCES: true,
  ENOTEMPTY: true,
  EMFILE: true,
  ENFILE: true,
};
const FS_RETRY_DELAYS_MS = [50, 100, 200, 400, 800];

/**
 * 同一 agentDir 上的铺设与复位在进程内排队：每次铺设都会清扫该目录下所有
 * `.staging-*` 与 `.backup-fixture-*` 并整体替换场景目录，并发执行时一个铺设会
 * 删掉另一个的 staging 或回滚备份。队列按 `comparableDirectory` 的目录比较键分桶：
 * 符号链接、大小写变体与真实路径指向同一目录时必须共用一条队列，按字面路径分桶会
 * 让它们各自拿到一把锁。执行完最后一个排队者后自动摘除表项；跨进程不设约束，
 * 样本目录只给测试与手工验证使用。
 *
 * 导出仅供测试验证排队语义：真实铺设的并发窗口太短，无法稳定复现锁失效。
 */
const agentDirQueues = new Map<string, Promise<void>>();

export function withAgentDirLock<T>(agentDir: string, operation: () => Promise<T>): Promise<T> {
  const key = comparableDirectory(agentDir);
  const previous = agentDirQueues.get(key) ?? Promise.resolve();
  // 前一个操作失败也要让后面排队的继续：两个分支都接操作本身，只传递完成信号。
  const run = previous.then(operation, operation);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  agentDirQueues.set(key, settled);
  return run.finally(() => {
    // 后面已有排队者时它已经接管队尾，这里不能把它的表项删掉。
    if (agentDirQueues.get(key) === settled) agentDirQueues.delete(key);
  });
}

const SCENARIO_TITLES: Record<SessionScenario, string> = {
  "single-turn": "伪造会话 single-turn",
  empty: "伪造会话 empty",
  branch: "伪造会话 branch",
  subagent: "伪造会话 subagent",
  tools: "伪造会话 tools",
  long: "伪造会话 long",
  "skill-command": "伪造会话 skill-command",
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
const SKILL_COMMAND_NAME = "demo-skill";
const SKILL_COMMAND_ARGS = "只回复第一句";
const SKILL_COMMAND_PROMPT = `/skill:${SKILL_COMMAND_NAME} ${SKILL_COMMAND_ARGS}`;
// 技能正文只存在于 custom_message 里，标题与预览要显示用户敲的指令。
const SKILL_COMMAND_BODY = "用户调用了 demo-skill，照它写的流程执行。";
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
  const agentDir = resolveFixtureAgentDir(options?.agentDir);
  if (!Object.hasOwn(SCENARIO_TITLES, scenario)) {
    throw new Error(`session-fixtures: 未知场景 ${String(scenario)}`);
  }

  const title = options.title ?? SCENARIO_TITLES[scenario];
  const messageTime = parseTimestamp(options.timestamp ?? DEFAULT_TIMESTAMP);
  const scenarioDir = join(agentDir, SESSIONS_DIR, `${FIXTURE_PREFIX}${scenario}`);

  return withAgentDirLock(agentDir, async () => {
    const sessionsDir = join(agentDir, SESSIONS_DIR);
    // sessions 的真实路径检查必须早于 assertFixtureAgentDir 的 mkdir 与清扫的删除：
    // 链接目标一旦先被建目录或删掉 staging，守卫就失去意义。
    assertSessionsDirInsideAgentDir(agentDir);
    await assertFixtureAgentDir(agentDir);
    await sweepStaleDirectories(agentDir);
    await assertFixtureSessionsDir(sessionsDir);
    const stagingDir = join(sessionsDir, `${STAGING_PREFIX}${randomUUID()}`);
    await mkdir(stagingDir, { recursive: true });

    try {
      await options.onStagingReady?.();
      const plan = await buildScenario(scenario, { cwd: options.cwd, title, messageTime }, stagingDir);
      const children = await replaceDirectory(stagingDir, scenarioDir, agentDir, () => plan.extend(scenarioDir));
      return [...plan.sessions, ...children].map((session) => ({
        id: session.id,
        path: join(scenarioDir, basename(session.file)),
        title: session.title,
        cwd: session.cwd,
      }));
    } finally {
      // 正常情况下 staging 已被改名，force 让这次清理变成空操作；删不掉只记录，
      // 不让清理错误盖掉上面抛出的原始错误。
      try {
        await removeWithRetry(stagingDir);
      } catch (error) {
        console.warn(`session-fixtures: 清理 staging ${stagingDir} 失败`, error);
      }
    }
  });
}

/**
 * 手工入口：删掉 agentDir 下所有样本目录与替换阶段残留的中间目录。
 *
 * 守卫与 seedSessions 共用同一套（活动 agent 目录关系、真实用户配置根、顶层条目、
 * sessions 真实路径与内容）：误传真实 agent 目录会被拒绝，符号链接也按真实路径
 * 判断。删除前只做只读检查：目录不存在就直接返回，检查不创建任何目录。
 */
export async function resetSessionFixtures(agentDir: string): Promise<void> {
  const resolved = resolveFixtureAgentDir(agentDir);
  await withAgentDirLock(resolved, async () => {
    const entries = await readAgentDirEntries(resolved);
    if (entries === null) return;
    assertOnlySessions(entries);
    const sessionsDir = join(resolved, SESSIONS_DIR);
    assertSessionsDirInsideAgentDir(resolved);
    await sweepStaleDirectories(resolved);
    await assertFixtureSessionsDir(sessionsDir);
    for (const entry of await listSubdirectories(sessionsDir)) {
      if (entry.name.startsWith(FIXTURE_PREFIX)) {
        await removeWithRetry(join(sessionsDir, entry.name));
      }
    }
  });
}

function requireAgentDir(agentDir: string | undefined): string {
  if (typeof agentDir !== "string" || agentDir.trim() === "") {
    throw new Error("session-fixtures: 必须提供非空的 agentDir");
  }
  return resolve(agentDir);
}

/**
 * seedSessions 与 resetSessionFixtures 共用的入口守卫：解析非空路径，再拒绝位于
 * 真实用户配置根之下的目标，以及与活动 agent 目录冲突的目标。两处必须用同一套
 * 判断，否则复位会绕过铺设的守卫，把真实目录里的样本删掉。
 */
function resolveFixtureAgentDir(agentDir: string | undefined): string {
  const resolved = requireAgentDir(agentDir);
  assertOutsideConfigRoot(resolved);
  assertActiveAgentDirSeparate(resolved);
  return resolved;
}

/**
 * 真实用户配置根（`~/.omp`，含 profiles 与 PI_CONFIG_DIR 覆盖）之下的一切目录都
 * 可能是真实 agent 目录：它可能尚未创建（顶层为空）或只含 sessions，条目检查都会
 * 放行；符号链接按真实路径判断，指回配置根的链接同样拒绝。
 */
function assertOutsideConfigRoot(agentDir: string): void {
  const configRoot = comparableDirectory(getBaseConfigRoot());
  if (relativePathWithinNormalizedRoot(configRoot, comparableDirectory(agentDir)) !== null) {
    throw new Error(
      `session-fixtures: agentDir 不能位于真实用户配置根 ${configRoot} 之下（${agentDir}）：`
        + "真实的 agent 目录可能尚未创建或只含 sessions，条目检查会放行，样本就会写进用户数据。"
        + '请改用任务临时目录，例如 join(mkdtempSync(join(tmpdir(), "ompdesk-")), "agent")',
    );
  }
}

/**
 * 设置标题会写活动 agent 目录的 history.db。三种活动目录都会把样本索引写进不该
 * 写的地方，必须在写任何文件之前拒绝：与目标 agentDir 指向同一真实目录的、位于
 * 目标 agentDir 内部的（会在样本树里生成 history.db，破坏下一次铺设与复位），以及
 * 位于真实用户配置根（`~/.omp`，含 profiles 与 PI_CONFIG_DIR 覆盖）之下的。
 *
 * 符号链接与 Windows 上的路径大小写都会让字面路径不同却指向同一目录：比较前先解析
 * 真实路径（macOS 上它同时把大小写变体归一到磁盘写法），目录还不存在时解析最近的
 * 已存在祖先，Windows 上再折叠大小写。
 */
function assertActiveAgentDirSeparate(agentDir: string): void {
  const activeAgentDir = getAgentDir();
  const active = comparableDirectory(activeAgentDir);
  const target = comparableDirectory(agentDir);
  if (active === target) {
    throw new Error(
      `session-fixtures: 活动 agent 目录不能与目标 agentDir 相同（${agentDir}）：`
        + "setSessionName 会把标题写进该目录的 history.db。"
        + "铺样本前先把活动目录切到目标之外，例如 setAgentDir(runtimeDir) 后再调用 "
        + "seedSessions(scenario, { agentDir })",
    );
  }

  if (relativePathWithinNormalizedRoot(target, active) !== null) {
    throw new Error(
      `session-fixtures: 活动 agent 目录位于目标 agentDir 内部（${activeAgentDir} 在 ${agentDir} 之下）：`
        + "setSessionName 会在样本树里创建 history.db，破坏下一次铺设与复位。"
        + "铺样本前先把活动目录切到 agentDir 之外，例如 "
        + 'setAgentDir(join(tmpdir(), "runtime/agent"))',
    );
  }

  const configRoot = comparableDirectory(getBaseConfigRoot());
  if (relativePathWithinNormalizedRoot(configRoot, active) !== null) {
    throw new Error(
      `session-fixtures: 活动 agent 目录位于真实用户配置根 ${configRoot} 之下（${activeAgentDir}）：`
        + "setSessionName 会把标题写进该目录的 history.db。"
        + "铺样本前先把活动目录切到任务临时目录，例如 "
        + 'setAgentDir(join(tmpdir(), "runtime/agent"))',
    );
  }
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
 * models.yml，放行会把样本写进用户数据。替换阶段残留的备份也放行，交给清扫删除。
 *
 * 配置根之下的目录由 resolveFixtureAgentDir 提前拒绝；尚未创建的 agentDir
 * 顶层为空，检查会直接放行，随后 mkdir。
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

/**
 * 只放行空目录、sessions 与替换阶段我们自己留下的 fixture 备份：带 agent.db、
 * models.yml 的是真实 agent 目录。备份由清扫删除，名字必须是我们生成的形状。
 */
function assertOnlySessions(entries: readonly string[]): void {
  const unexpected = entries.filter(
    (name) => name !== SESSIONS_DIR && !name.startsWith(FIXTURE_BACKUP_PREFIX),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `session-fixtures: agentDir 只能包含 ${SESSIONS_DIR} 与替换备份，实际还有 ${unexpected.join("、")}`,
    );
  }
}

/**
 * `sessions` 的真实路径必须位于 agentDir 归一化路径之内：`sessions` 被换成指向别处
 * 的符号链接时，`readdir` 与 `mkdir` 都照常工作，清扫会删掉链接目标里的 `.staging-*`，
 * 样本也会写进链接目标。调用方必须在任何写入或删除之前执行本检查。
 */
function assertSessionsDirInsideAgentDir(agentDir: string): void {
  const root = comparableDirectory(agentDir);
  const sessions = comparableDirectory(join(agentDir, SESSIONS_DIR));
  if (relativePathWithinNormalizedRoot(root, sessions) === null) {
    throw new Error(
      `session-fixtures: agentDir 的 ${SESSIONS_DIR} 必须位于 agentDir 之内，`
        + `实际解析到 ${sessions}（agentDir 为 ${root}）：`
        + "符号链接会让清扫与样本写入落到链接目标。",
    );
  }
}

/**
 * sessions 下的子目录名只允许 fixture-*：真实的 agent 目录在这里按工作目录分桶，
 * 放行会把样本混进用户会话。
 */
async function assertFixtureSessionsDir(sessionsDir: string): Promise<void> {
  const unexpected = (await listSubdirectories(sessionsDir))
    .filter((entry) => !entry.name.startsWith(FIXTURE_PREFIX))
    .map((entry) => entry.name);
  if (unexpected.length > 0) {
    throw new Error(
      `session-fixtures: agentDir 的 ${SESSIONS_DIR} 只允许 ${FIXTURE_PREFIX}* 目录，`
        + `实际还有 ${unexpected.join("、")}`,
    );
  }
}

/**
 * 只读列出子目录；符号链接条目同样计入：链接指向真实会话目录时，按 `isDirectory()`
 * 过滤会把 `.staging-*`、`.backup-*` 与 `fixture-*` 链接一并漏掉，守卫与清扫都失效。
 * 删除这类条目删的是链接本身（`rm` 递归删除不跟进链接），链接目标保持原样。
 */
async function listSubdirectories(root: string): Promise<Dirent[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink());
}

/**
 * 进程在替换阶段被杀会留下 .staging-*（sessions 下）或 .backup-*（agentDir 顶层）
 * 目录：staging 里的 .jsonl 会被会话列表当成额外会话，必须先扫掉；备份在 sessions
 * 之外，只是不再需要的垃圾，同样一并删除。铺样本与复位前都会调用。
 */
async function sweepStaleDirectories(agentDir: string): Promise<void> {
  for (const entry of await listSubdirectories(agentDir)) {
    if (entry.name.startsWith(FIXTURE_BACKUP_PREFIX)) {
      await removeWithRetry(join(agentDir, entry.name));
    }
  }
  const sessionsDir = join(agentDir, SESSIONS_DIR);
  for (const entry of await listSubdirectories(sessionsDir)) {
    if (entry.name.startsWith(STAGING_PREFIX)) {
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
    case "skill-command":
      return buildSkillCommandScenario(options, stagingDir);
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

/**
 * 首条消息是用户手动调用的技能指令：落盘为 custom_message，没有用户消息。
 * 标题与列表预览因此只能从 details 里取指令，正文不能漏到标题上。
 */
async function buildSkillCommandScenario(
  options: { cwd: string; title: string; messageTime: number },
  stagingDir: string,
): Promise<ScenarioPlan> {
  const manager = SessionManager.create(options.cwd, stagingDir);
  try {
    manager.appendCustomMessageEntry(
      "skill-prompt",
      SKILL_COMMAND_BODY,
      true,
      {
        name: SKILL_COMMAND_NAME,
        args: SKILL_COMMAND_ARGS,
        prompt: SKILL_COMMAND_PROMPT,
        lineCount: 1,
      },
      "user",
      options.messageTime,
    );
    // 助手紧接着回复：列表扫描会把这条回复当成首条消息，标题因此仍须取指令。
    manager.appendMessage(
      assistantMessage("已经按 demo-skill 的流程处理。", options.messageTime + 1000),
    );
    await manager.setSessionName(options.title, "user");
    await manager.ensureOnDisk();
    await manager.flush();
    return { sessions: [snapshotSession(manager, options.title)], extend: async () => [] };
  } finally {
    await manager.close();
  }
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
 * 备份落在 agentDir 顶层（`.backup-fixture-<scenario>-<uuid>`），不在 sessions 里：
 * 删除失败也不会有 .jsonl 被会话扫描当成额外会话，残留由下次铺设或复位清扫。
 */
async function replaceDirectory<T>(
  stagingDir: string,
  targetDir: string,
  backupRoot: string,
  finish: () => Promise<T>,
): Promise<T> {
  const backupDir = join(backupRoot, `${BACKUP_PREFIX}${basename(targetDir)}-${randomUUID()}`);
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
      // 备份删不掉不影响已铺好的场景，也不会出现在会话列表里：它在 sessions 之外，
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

/** 删除目录同样会在 Windows 上撞到句柄竞争，与改名共用一套重试。 */
async function removeWithRetry(target: string): Promise<void> {
  await retryWhileBusy(() => rm(target, { recursive: true, force: true }));
}

async function retryWhileBusy<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const retryable = code !== undefined && FS_RETRYABLE_CODES[code] === true;
      if (!retryable || attempt >= FS_RETRY_DELAYS_MS.length) {
        throw error;
      }
      await delay(FS_RETRY_DELAYS_MS[attempt]);
    }
  }
}
