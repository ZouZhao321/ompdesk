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
import {
  getAgentDir,
  relativePathWithinNormalizedRoot,
  setAgentDir,
  __resetDirsFromEnvForTests,
} from "@oh-my-pi/pi-utils/dirs";
import { comparableDirectory } from "./path-compare";

/** 活动 agent 目录在沙箱里的固定位置。 */
const RUNTIME_AGENT_DIR = "runtime/agent";

/**
 * 建沙箱目录失败：父目录不存在、无权限、被占用都是环境限制，调用方可以据此跳过用例。
 *
 * 只有 `mkdtempSync` / `mkdirSync` 这一步的失败用这个类型。切换与复位活动目录另有
 * 错误路径，抛出去的是 SDK 或本模块自己的错误——那些是回归，必须让用例失败。
 */
export class SandboxDirectoryCreateError extends Error {
  constructor(target: string, cause: unknown) {
    super(`无法创建沙箱目录：${target}`, { cause });
    this.name = "SandboxDirectoryCreateError";
  }
}

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
  try {
    setAgentDir(dir);
    resetAgentDirState();
  } catch (error) {
    // 切换可能停在半路（目录已改、索引还是旧的）。不先回到快照，调用方删掉临时
    // 目录后活动目录就会指向已删除的目录；恢复失败只记录，原始错误照常抛出。
    restoreSnapshotOrResetState(snapshot, `恢复活动 agent 目录（切换到 ${dir} 失败后）`);
    throw error;
  }
  return snapshot;
}

export function restoreAgentDir(snapshot: AgentDirSnapshot): void {
  // `setAgentDir` 抛错时 `PI_CODING_AGENT_DIR` 也必须回到快照：环境变量与目录解析
  // 是同一份事实的两处投影，只留下沙箱环境的话，后续任何一次从环境重建都会再指回
  // 即将删除的沙箱目录。
  try {
    setAgentDir(snapshot.agentDir);
  } finally {
    if (snapshot.env === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = snapshot.env;
    resetAgentDirState();
  }
}

/** 目录解析与会话索引都从当前环境重建，两者必须一起复位。 */
function resetAgentDirState(): void {
  __resetDirsFromEnvForTests();
  resetSessionIndexForTests();
}

/**
 * 恢复到快照；恢复本身失败时只记录，再补一次目录解析与会话索引的重建：两处复位
 * 都幂等，恢复停在半路时它们可能仍指向沙箱，后续用例就会写进待删除的目录。
 */
function restoreSnapshotOrResetState(snapshot: AgentDirSnapshot, action: string): void {
  try {
    restoreAgentDir(snapshot);
    return;
  } catch (error) {
    warnCleanupFailure(action, error);
  }
  try {
    resetAgentDirState();
  } catch (error) {
    warnCleanupFailure(`${action}后重建目录解析与会话索引`, error);
  }
}

/**
 * 活动 agent 目录是否仍落在沙箱里。删掉沙箱前必须确认为 false：活动目录指向已删除
 * 的目录会让后续用例把数据写进不存在的路径。读不到活动目录或比较不出结果时按
 * 「仍在沙箱」处理。
 */
function activeAgentDirWithinSandbox(root: string): boolean {
  let activeAgentDir: string;
  try {
    activeAgentDir = getAgentDir();
  } catch (error) {
    warnCleanupFailure(`读取活动 agent 目录（${root}）`, error);
    return true;
  }
  // 与样本守卫共用同一套归一：沙箱根里的符号链接（macOS 的 /var → /private/var）
  // 由真实路径解析归一，Windows 上再折叠大小写。否则经链接写成的活动目录会被判成
  // 在沙箱之外，删掉沙箱后活动目录就指向了已删除的路径。
  try {
    return relativePathWithinNormalizedRoot(comparableDirectory(root), comparableDirectory(activeAgentDir)) !== null;
  } catch (error) {
    // 比较本身也要读文件系统（realpath），EACCES/EPERM/ELOOP 时比不出结论。此处只能
    // 保守：保留目录只会漏删，删掉却会让后续用例写进已删除的路径；抛出还会中断
    // t.after 的清理和用例对原始错误的报告。
    warnCleanupFailure(`比较活动 agent 目录与沙箱（${root}）`, error);
    return true;
  }
}

function warnCleanupFailure(action: string, error: unknown): void {
  console.warn(`ompdesk 测试沙箱清理失败：${action}`, error);
}

/**
 * 建临时目录并铺出子目录。只有这一步的失败包成 `SandboxDirectoryCreateError`：
 * 建不出目录是环境限制，后续的切换与复位失败才是回归。
 */
function createSandboxRoot(options: AgentDirSandboxOptions): string {
  let root: string | undefined;
  try {
    root = mkdtempSync(join(tmpdir(), options.prefix));
    for (const dir of [RUNTIME_AGENT_DIR, ...options.dirs]) mkdirSync(join(root, dir), { recursive: true });
    return root;
  } catch (error) {
    throw new SandboxDirectoryCreateError(root ?? `前缀 ${options.prefix} 的临时目录`, error);
  }
}

/**
 * 铺出沙箱并把活动目录切进去，用例结束自动恢复与清理。
 *
 * 清理先跑 `beforeRestore`，再恢复活动 agent 目录；两步各自兜错，失败只记录，
 * 不翻转用例结果。临时目录只在恢复成功之后删除：恢复失败时活动目录仍指向沙箱，
 * 删掉它会让后续用例写进已删除的目录，此时保留目录交给系统回收。删除本身也可能
 * 短暂报 EBUSY——history.db 的句柄是模块级的，Windows 上关闭句柄到目录可删除之间
 * 有延迟——同样只记录。
 */
export function createAgentDirSandbox(t: SandboxCleanupHost, options: AgentDirSandboxOptions): AgentDirSandbox {
  const root = createSandboxRoot(options);
  const agentDir = join(root, RUNTIME_AGENT_DIR);

  let previous: AgentDirSnapshot;
  try {
    previous = switchAgentDir(agentDir);
  } catch (error) {
    // 切换可能停在半路（目录已改、索引还是旧的），此时 t.after 尚未注册，没人会
    // 收拾这棵临时目录。但内部恢复也可能失败：活动目录仍指向 root 时删掉它会让
    // 后续用例写进已删除的目录，保留目录交给系统回收。
    if (activeAgentDirWithinSandbox(root)) {
      console.warn(`ompdesk 测试沙箱保留临时目录 ${root}：活动 agent 目录仍指向它`);
    } else {
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch (cleanupError) {
        warnCleanupFailure(`删除临时目录 ${root}`, cleanupError);
      }
    }
    throw error;
  }

  t.after(() => {
    try {
      options.beforeRestore?.();
    } catch (error) {
      warnCleanupFailure(`beforeRestore（${root}）`, error);
    }

    restoreSnapshotOrResetState(previous, `恢复活动 agent 目录（${root}）`);

    // 活动目录仍指向沙箱：删掉 root 会让后续用例写进已删除的目录，保留目录交给
    // 系统回收。
    if (activeAgentDirWithinSandbox(root)) {
      console.warn(`ompdesk 测试沙箱保留临时目录 ${root}：活动 agent 目录仍指向它`);
      return;
    }

    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (error) {
      warnCleanupFailure(`删除临时目录 ${root}`, error);
    }
  });

  return { root, agentDir };
}
