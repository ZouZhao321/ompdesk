/**
 * 会话样本：用 SessionManager 生成能被 SessionManager.listAll 读回的伪造会话，
 * 测试与手工验证共用同一个入口。
 *
 * 每个场景落在 <agentDir>/sessions/fixture-<scenario>。生成过程先写到同一层的
 * .staging-<随机> 目录，成功后整体替换场景目录：重复铺设不会累积文件，中途失败
 * 也不会留下半个场景。
 *
 * branch 与 subagent 场景的父会话先由 SessionManager.create 写出，经 staging 原子
 * 替换进场景目录后再用 SessionManager.open + createBranchedSession 补写子会话：
 * 子会话头部记录的是父文件的最终路径，父文件本身不被改写。
 *
 * 设置标题会写活动 agent 目录的 history.db，因此活动 agent 目录要放在 agentDir
 * 之外（例如任务临时目录的另一处），不要把 PI_CODING_AGENT_DIR 指向 agentDir。
 */
import { randomUUID } from "crypto";
import type { Dirent } from "fs";
import { mkdir, readdir, rename, rm, stat } from "fs/promises";
import { basename, join, resolve } from "path";
import { setTimeout as delay } from "timers/promises";
import { SessionManager } from "@oh-my-pi/pi-coding-agent";

export type SessionScenario = "single-turn" | "empty" | "branch" | "subagent";

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
// Windows 上关闭写入句柄到目录可改名之间有延迟，rename 会短暂报 EPERM/EBUSY。
const RENAME_RETRY_DELAYS_MS = [50, 100, 200, 400, 800];

const SCENARIO_TITLES: Record<SessionScenario, string> = {
  "single-turn": "伪造会话 single-turn",
  empty: "伪造会话 empty",
  branch: "伪造会话 branch",
  subagent: "伪造会话 subagent",
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

type SessionMessage = Parameters<SessionManager["appendMessage"]>[0];

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
  if (!Object.hasOwn(SCENARIO_TITLES, scenario)) {
    throw new Error(`session-fixtures: 未知场景 ${String(scenario)}`);
  }

  const title = options.title ?? SCENARIO_TITLES[scenario];
  const messageTime = parseTimestamp(options.timestamp ?? DEFAULT_TIMESTAMP);
  const scenarioDir = join(agentDir, SESSIONS_DIR, `${FIXTURE_PREFIX}${scenario}`);

  await assertFixtureAgentDir(agentDir);
  const sessionsDir = join(agentDir, SESSIONS_DIR);
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
    await rm(stagingDir, { recursive: true, force: true });
  }
}

export async function resetSessionFixtures(agentDir: string): Promise<void> {
  const sessionsDir = join(requireAgentDir(agentDir), SESSIONS_DIR);
  let entries: Dirent[];
  try {
    entries = await readdir(sessionsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith(FIXTURE_PREFIX)) {
      await rm(join(sessionsDir, entry.name), { recursive: true, force: true });
    }
  }
}

function requireAgentDir(agentDir: string | undefined): string {
  if (typeof agentDir !== "string" || agentDir.trim() === "") {
    throw new Error("session-fixtures: 必须提供非空的 agentDir");
  }
  return resolve(agentDir);
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
  let entries: string[];
  try {
    entries = await readdir(agentDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await mkdir(agentDir, { recursive: true });
      return;
    }
    throw error;
  }

  const unexpected = entries.filter((name) => name !== SESSIONS_DIR);
  if (unexpected.length > 0) {
    throw new Error(
      `session-fixtures: agentDir 只能包含 ${SESSIONS_DIR}，实际还有 ${unexpected.join("、")}`,
    );
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
    manager.createBranchedSession(leafId);
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

function assistantMessage(text: string, timestamp: number): SessionMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "fixture",
    provider: "fixture",
    model: "fixture",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp,
  };
}

/**
 * 用 staging 目录整体替换场景目录，替换后在同一目录补写会话；任一步失败都删掉
 * 新目录并恢复原场景。
 */
async function replaceDirectory<T>(
  stagingDir: string,
  targetDir: string,
  finish: () => Promise<T>,
): Promise<T> {
  const backupDir = `${targetDir}${BACKUP_PREFIX}${randomUUID()}`;
  const replaceExisting = await pathExists(targetDir);
  if (replaceExisting) {
    await renameWithRetry(targetDir, backupDir);
  }

  try {
    await renameWithRetry(stagingDir, targetDir);
    const result = await finish();
    if (replaceExisting) {
      await rm(backupDir, { recursive: true, force: true });
    }
    return result;
  } catch (error) {
    await rm(targetDir, { recursive: true, force: true });
    if (replaceExisting) {
      await renameWithRetry(backupDir, targetDir);
    }
    throw error;
  }
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
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const retryable = code === "EPERM" || code === "EBUSY" || code === "EACCES";
      if (!retryable || attempt >= RENAME_RETRY_DELAYS_MS.length) {
        throw error;
      }
      await delay(RENAME_RETRY_DELAYS_MS[attempt]);
    }
  }
}
