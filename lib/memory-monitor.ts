/**
 * 进程内存采样。
 *
 * 采样只读 `process.memoryUsage()` 与进程运行时长，不接触会话、请求、模型调用或
 * 业务状态，因此可以在生产进程里长期运行。采样结果本身不带结论，调用方把它写成
 * `process.memory` 记录，与 HTTP、agent 记录落在同一份文件里，按时间顺序对齐。
 *
 * 只覆盖本进程：会话派生的守护进程、语言服务等子进程有各自的内存，不在
 * `process.memoryUsage()` 的视野内。
 */

/** 采样间隔的环境变量。 */
export const MEMORY_SAMPLE_INTERVAL_ENV = "OMPDESK_MEMORY_SAMPLE_MS";

/** 未配置时的采样间隔。 */
export const DEFAULT_MEMORY_SAMPLE_INTERVAL_MS = 60_000;

/** 更短的正数按未配置处理，避免把日志写成采样文件。 */
export const MIN_MEMORY_SAMPLE_INTERVAL_MS = 1_000;

/** 一次采样结果。内存数值单位为字节，`uptimeSec` 是进程已运行的秒数。 */
export interface MemorySample {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
  uptimeSec: number;
}

/** `process.memoryUsage()` 的只读子集；Bun 与 Node 都提供这些字段。 */
export interface MemoryUsageLike {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers?: number;
}

/**
 * 读取一次内存快照。
 *
 * `rss` 是进程占用的物理内存；`heapUsed` 与 `heapTotal` 是 JavaScript 堆的已用与
 * 已分配；`external` 与 `arrayBuffers` 是堆外的原生与缓冲区内存。两者之差说明内存在
 * 堆上还是在原生侧。
 */
export function readMemorySample(
  usage: MemoryUsageLike = process.memoryUsage(),
  uptimeSec: number = process.uptime(),
): MemorySample {
  return {
    rss: Math.round(usage.rss),
    heapTotal: Math.round(usage.heapTotal),
    heapUsed: Math.round(usage.heapUsed),
    external: Math.round(usage.external),
    arrayBuffers: Math.round(usage.arrayBuffers ?? 0),
    uptimeSec: Math.round(uptimeSec),
  };
}

/**
 * 解析采样间隔。
 *
 * `OMPDESK_MEMORY_SAMPLE_MS` 为 `0` 时关闭采样；空的、非数字、负数与短于
 * `MIN_MEMORY_SAMPLE_INTERVAL_MS` 的值一律按未配置处理，返回默认间隔。
 */
export function resolveMemorySampleIntervalMs(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env[MEMORY_SAMPLE_INTERVAL_ENV]?.trim();
  if (!raw) return DEFAULT_MEMORY_SAMPLE_INTERVAL_MS;
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_MEMORY_SAMPLE_INTERVAL_MS;
  if (value === 0) return undefined;
  if (value < MIN_MEMORY_SAMPLE_INTERVAL_MS) return DEFAULT_MEMORY_SAMPLE_INTERVAL_MS;
  return Math.round(value);
}

/** 定时器来源；测试用假实现驱动采样，不依赖真实时间。 */
export interface MemoryMonitorClock {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

const defaultClock: MemoryMonitorClock = {
  setInterval(callback, intervalMs) {
    const handle: unknown = setInterval(callback, intervalMs);
    // 采样器不应以自身的理由阻止进程退出。Bun 与 Node 的定时器都带 `unref`。
    if (handle && typeof handle === "object" && "unref" in handle && typeof handle.unref === "function") {
      handle.unref();
    }
    return handle;
  },
  clearInterval(handle) {
    clearInterval(handle as NodeJS.Timeout);
  },
};

export interface MemoryMonitorOptions {
  /** 接收每次采样；异常由调用方承担，采样器不重试。 */
  emit: (sample: MemorySample, intervalMs: number) => void;
  /** 采样间隔；缺省时读 `OMPDESK_MEMORY_SAMPLE_MS`。 */
  intervalMs?: number;
  /** 解析间隔时使用的环境变量，默认 `process.env`。 */
  env?: NodeJS.ProcessEnv;
  /** 定时器实现，默认使用全局定时器。 */
  clock?: MemoryMonitorClock;
}

/**
 * Next 把 instrumentation 与每个路由编译成不同的模块实例，本模块因此会在同一进程
 * 里被加载多份。定时器状态挂在 `globalThis` 上，保证整进程只有一份。
 */
const MONITOR_STATE = Symbol.for("ompdesk.memory-monitor");

interface RunningMonitor {
  handle: unknown;
  clock: MemoryMonitorClock;
}

const monitorState = globalThis as unknown as Record<symbol, RunningMonitor | undefined>;

/**
 * 启动采样：立即采一次作为基线，此后按间隔采样。
 *
 * 已经在运行、或间隔被关闭时返回 `false`。
 */
export function startMemoryMonitor(options: MemoryMonitorOptions): boolean {
  if (monitorState[MONITOR_STATE]) return false;
  const intervalMs = options.intervalMs ?? resolveMemorySampleIntervalMs(options.env);
  if (intervalMs === undefined) return false;

  const clock = options.clock ?? defaultClock;
  const emit = () => options.emit(readMemorySample(), intervalMs);
  // 先登记再采样：emit 内部的日志写入可能再次触发启动路径。
  monitorState[MONITOR_STATE] = { handle: clock.setInterval(emit, intervalMs), clock };
  emit();
  return true;
}

/** 停止采样；没有运行中的采样器时什么也不做。 */
export function stopMemoryMonitor(): void {
  const running = monitorState[MONITOR_STATE];
  if (!running) return;
  monitorState[MONITOR_STATE] = undefined;
  running.clock.clearInterval(running.handle);
}
