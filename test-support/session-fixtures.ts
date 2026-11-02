/**
 * 会话样本：用 SessionManager 生成能被 SessionManager.listAll 读回的伪造会话，
 * 测试与手工验证共用同一个入口。
 *
 * 每个场景落在 <agentDir>/sessions/fixture-<scenario>。生成过程先写到同一层的
 * .staging-<随机> 目录，成功后整体替换场景目录：重复铺设不会累积文件，中途失败
 * 也不会留下半个场景。
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

export type SessionScenario = "single-turn" | "empty";

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
};

const SINGLE_TURN_USER_TEXT = "伪造会话 single-turn 的用户消息";
const SINGLE_TURN_ASSISTANT_TEXT = "伪造会话 single-turn 的助手回复";

type SessionMessage = Parameters<SessionManager["appendMessage"]>[0];

interface BuiltSession {
  id: string;
  file: string;
  title: string;
  cwd: string;
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
    const session = await buildSession(scenario, { cwd: options.cwd, title, messageTime }, stagingDir);
    await replaceDirectory(stagingDir, scenarioDir);
    return [
      {
        id: session.id,
        path: join(scenarioDir, basename(session.file)),
        title: session.title,
        cwd: session.cwd,
      },
    ];
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

async function buildSession(
  scenario: SessionScenario,
  options: { cwd: string; title: string; messageTime: number },
  stagingDir: string,
): Promise<BuiltSession> {
  const manager = SessionManager.create(options.cwd, stagingDir);
  try {
    if (scenario === "single-turn") {
      manager.appendMessage({
        role: "user",
        content: SINGLE_TURN_USER_TEXT,
        timestamp: options.messageTime,
      });
      manager.appendMessage(assistantMessage(options.messageTime));
    }

    await manager.setSessionName(options.title, "user");
    // 只有标题的会话不会因消息而落盘，显式写一次。
    await manager.ensureOnDisk();
    await manager.flush();

    const file = manager.getSessionFile();
    if (!file) {
      throw new Error("session-fixtures: 会话文件没有落盘");
    }
    return {
      id: manager.getSessionId(),
      file,
      title: manager.getSessionName() ?? options.title,
      cwd: manager.getCwd(),
    };
  } finally {
    await manager.close();
  }
}

function assistantMessage(timestamp: number): SessionMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: SINGLE_TURN_ASSISTANT_TEXT }],
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

/** 用 staging 目录整体替换场景目录，替换失败时恢复原场景。 */
async function replaceDirectory(stagingDir: string, targetDir: string): Promise<void> {
  const backupDir = `${targetDir}${BACKUP_PREFIX}${randomUUID()}`;
  const replaceExisting = await pathExists(targetDir);
  if (replaceExisting) {
    await renameWithRetry(targetDir, backupDir);
  }

  try {
    await renameWithRetry(stagingDir, targetDir);
  } catch (error) {
    if (replaceExisting) {
      await renameWithRetry(backupDir, targetDir);
    }
    throw error;
  }

  if (replaceExisting) {
    await rm(backupDir, { recursive: true, force: true });
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
