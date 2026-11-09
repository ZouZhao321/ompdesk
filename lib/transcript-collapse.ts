/**
 * 会话转写是否折叠压缩前的历史，按会话所属目录读设置。
 *
 * 这是展示项。读设置失败时按不折叠处理并记一条日志：会话读取路径不能因为
 * `agent.db` 被锁或项目配置损坏而整条返回 500，那会连会话本身都打不开。
 */
import type { Settings } from "@oh-my-pi/pi-coding-agent";
import { logEvent } from "./logging";
import { getSettingsForCwd } from "./omp-runtime";
import { getSettingForWeb } from "./omp-settings";

/**
 * 读设置失败时写日志的节流窗口（毫秒）。
 *
 * 会话转写是高频路径，项目配置损坏又是持续状态：不节流会按请求量刷同一行日志。
 * 同一 cwd 与同一类错误在一个窗口内只记一次。
 */
const FAILURE_LOG_INTERVAL_MS = 60_000;

/** 节流状态的条目上限：达到上限先清过期项，仍满则丢最早的一条。 */
const FAILURE_LOG_MAX_KEYS = 64;

const lastFailureLoggedAt = new Map<string, number>();

/**
 * 会话转写是否折叠压缩前的历史。
 *
 * @param cwd 会话所属目录
 * @param readSettings 设置读取入口，测试用来注入失败与固定配置
 */
export async function shouldCollapseCompactedHistory(
  cwd: string | undefined,
  readSettings: (cwd: string | undefined) => Promise<Settings> = getSettingsForCwd,
): Promise<boolean> {
  try {
    const settings = await readSettings(cwd);
    return getSettingForWeb(settings, "display.collapseCompacted") === true;
  } catch (error) {
    // 日志是回落路径上的旁支：它自己再抛一次，就把「读设置失败不报 500」的约定毁了。
    try {
      logThrottled(cwd, error);
    } catch {
      // 记日志失败时静默，回落仍然成立。
    }
    return false;
  }
}

/** 入键的消息长度上限：保留区分度，又不让长消息把状态撑大。 */
const FAILURE_KEY_MESSAGE_CHARS = 80;

/**
 * 节流键：同一 cwd 与同一类错误算同一条。
 *
 * 只取错误码或名称会把不同原因并成一条（普通 `Error` 的 name 恒为 "Error"，锁冲突与
 * 配置损坏就分不开），所以再带上截断后的消息；消息里的长路径与等待时长被截在 80 字符
 * 以内，状态仍由 `FAILURE_LOG_MAX_KEYS` 约束。
 * @param error 失败原因
 */
function failureKey(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code ?? error.name;
    return `${code}\u0000${error.message.slice(0, FAILURE_KEY_MESSAGE_CHARS)}`;
  }
  return String(error).slice(0, FAILURE_KEY_MESSAGE_CHARS);
}

/**
 * 同一 cwd 与同一类错误在窗口内只记一次。
 * @param cwd 会话所属目录
 * @param error 失败原因
 */
function logThrottled(cwd: string | undefined, error: unknown): void {
  const key = `${cwd ?? ""}\u0000${failureKey(error)}`;
  const now = Date.now();
  const last = lastFailureLoggedAt.get(key);
  if (last !== undefined && now - last < FAILURE_LOG_INTERVAL_MS) return;

  if (!lastFailureLoggedAt.has(key) && lastFailureLoggedAt.size >= FAILURE_LOG_MAX_KEYS) {
    for (const [entryKey, loggedAt] of lastFailureLoggedAt) {
      if (now - loggedAt >= FAILURE_LOG_INTERVAL_MS) lastFailureLoggedAt.delete(entryKey);
    }
    if (lastFailureLoggedAt.size >= FAILURE_LOG_MAX_KEYS) {
      const oldest = lastFailureLoggedAt.keys().next();
      if (!oldest.done) lastFailureLoggedAt.delete(oldest.value);
    }
  }

  // Map 的顺序代表最近记录时间，淘汰逻辑据此取「最早一条」：已有的键先删再写，
  // 否则 set 只更新值、不刷新顺序，热点键会被当成最早一条误删。
  lastFailureLoggedAt.delete(key);
  lastFailureLoggedAt.set(key, now);
  logEvent("warn", "system", "settings.collapse_compacted.read_failed", {
    cwd,
    error: error instanceof Error ? error.message : String(error),
  });
}
