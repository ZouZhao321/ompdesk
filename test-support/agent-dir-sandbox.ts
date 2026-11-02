/**
 * 测试用的活动 agent 目录沙箱。
 *
 * 每个用例一份临时目录，`runtime/agent` 作为活动 agent 目录，样本与工作目录放在
 * 同层的其他子目录里：铺样本会把标题写进活动目录的 history.db，两者相同就会写进
 * 真实目录。用例结束时恢复进入沙箱前的活动目录，再删掉整棵临时目录。
 *
 * 切换目录的顺序固定为 setAgentDir → __resetDirsFromEnvForTests →
 * resetSessionIndexForTests，恢复时连 PI_CODING_AGENT_DIR 一起还原；顺序写错会让
 * 目录解析或会话索引读到上一轮的快照。
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetSessionIndexForTests } from "@oh-my-pi/pi-coding-agent/session/session-index";
import { getAgentDir, setAgentDir, __resetDirsFromEnvForTests } from "@oh-my-pi/pi-utils/dirs";

/** 活动 agent 目录在沙箱里的固定位置。 */
const RUNTIME_AGENT_DIR = "runtime/agent";

export interface AgentDirSnapshot {
  agentDir: string;
  env: string | undefined;
}

/** 只依赖清理注册能力的用例上下文，node:test 的 TestContext 直接满足。 */
export interface SandboxCleanupHost {
  after(callback: () => void): void;
}

export interface AgentDirSandboxOptions {
  /** 临时目录前缀。 */
  prefix: string;
  /** 除 `runtime/agent` 之外要建在临时目录里的子目录。 */
  dirs: readonly string[];
  /** 恢复原活动目录之前执行，用于清掉指向沙箱的缓存。 */
  beforeRestore?: () => void;
}

export interface AgentDirSandbox {
  /** 临时目录根，子目录由调用方按 `options.dirs` 自行拼接。 */
  root: string;
  /** 用例期间的活动 agent 目录，即 `<root>/runtime/agent`。 */
  agentDir: string;
}

/**
 * 切换活动 agent 目录并重建目录解析状态与会话索引，返回切换前的值供恢复。
 *
 * 会话索引缓存着打开时的 history.db 连接：只重建目录解析的话，切换后可能仍
 * 沿用上一个 agent 目录的数据库。
 */
export function switchAgentDir(dir: string): AgentDirSnapshot {
  const snapshot = { agentDir: getAgentDir(), env: process.env.PI_CODING_AGENT_DIR };
  setAgentDir(dir);
  resetAgentDirState();
  return snapshot;
}

export function restoreAgentDir(snapshot: AgentDirSnapshot): void {
  setAgentDir(snapshot.agentDir);
  if (snapshot.env === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = snapshot.env;
  resetAgentDirState();
}

/** 目录解析与会话索引都从当前环境重建，两者必须一起复位。 */
function resetAgentDirState(): void {
  __resetDirsFromEnvForTests();
  resetSessionIndexForTests();
}

function warnCleanupFailure(action: string, error: unknown): void {
  console.warn(`ompdesk 测试沙箱清理失败：${action}`, error);
}

/**
 * 铺出沙箱并把活动目录切进去，用例结束自动恢复与清理。
 *
 * 清理分四步执行，每步单独兜错并保证后面的步骤仍然执行：活动 agent 目录必须
 * 恢复，临时目录必须尝试删除，否则后续用例会指向已删除的沙箱。失败只记录：
 * history.db 的句柄是模块级的，Windows 上关闭句柄到目录可删除之间有延迟，rm 会
 * 短暂报 EBUSY；临时目录交给系统回收，不翻转用例结果。
 */
export function createAgentDirSandbox(t: SandboxCleanupHost, options: AgentDirSandboxOptions): AgentDirSandbox {
  const root = mkdtempSync(join(tmpdir(), options.prefix));
  const agentDir = join(root, RUNTIME_AGENT_DIR);
  for (const dir of [RUNTIME_AGENT_DIR, ...options.dirs]) mkdirSync(join(root, dir), { recursive: true });

  let previous: AgentDirSnapshot;
  try {
    previous = switchAgentDir(agentDir);
  } catch (error) {
    // 切换可能停在半路（目录已改、索引还是旧的），此时 t.after 尚未注册，没人会
    // 收拾这棵临时目录：先删掉，再把原始错误交给用例。
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (cleanupError) {
      warnCleanupFailure(`删除临时目录 ${root}`, cleanupError);
    }
    throw error;
  }

  t.after(() => {
    try {
      options.beforeRestore?.();
    } catch (error) {
      warnCleanupFailure(`beforeRestore（${root}）`, error);
    } finally {
      try {
        restoreAgentDir(previous);
      } catch (error) {
        warnCleanupFailure(`恢复活动 agent 目录（${root}）`, error);
      } finally {
        try {
          resetSessionIndexForTests();
        } catch (error) {
          warnCleanupFailure(`重置会话索引（${root}）`, error);
        } finally {
          try {
            rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
          } catch (error) {
            warnCleanupFailure(`删除临时目录 ${root}`, error);
          }
        }
      }
    }
  });

  return { root, agentDir };
}
