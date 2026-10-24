import { randomUUID } from "crypto";
import { getLogContext, logEvent, type LogLevel } from "./logging";

/**
 * Agent 运行生命周期记录。
 *
 * 一次 run 对应一次 prompt：`agent.run.start` 与 `agent.run.end` 携带该次运行
 * 的模型元数据、耗时与 token 汇总；steer、follow_up、abort、fork、compact 的
 * 结果写成 `agent.run.command`。
 *
 * tracker 消费 SDK 事件序列并返回普通记录对象，因此状态机可以脱离
 * AgentSession 测试。除 `stopReason`、`provider`、`model` 与数值型 `usage`
 * 之外，不读取提示词、模型输出、消息内容与工具参数。
 */

/** 与 run 一起记录的命令结果。 */
export type AgentRunCommand = "steer" | "follow_up" | "abort" | "fork" | "compact";

/**
 * stopReason 来自 SDK 的 assistant message；`fork` 表示运行被会话 fork 打断，
 * `unknown` 表示 SDK 没有给出原因。
 */
export type AgentRunStopReason =
  | "stop"
  | "length"
  | "toolUse"
  | "error"
  | "aborted"
  | "fork"
  | "unknown";

export const AGENT_RUN_START = "agent.run.start";
export const AGENT_RUN_END = "agent.run.end";
export const AGENT_RUN_COMMAND = "agent.run.command";

export interface AgentRunRecord {
  level: LogLevel;
  message: string;
  fields: Record<string, unknown>;
}

/** prompt 被接受时立即捕获的元数据，此时模型信息仍然准确。 */
export interface AgentRunStart {
  sessionId: string;
  provider?: string;
  model?: string;
  role?: string;
  /** 本轮实际生效的 thinking 级别。 */
  thinkingLevel?: string;
  /** 与生效级别不同时，用户配置的选择器（例如 `auto`）。 */
  configuredThinkingLevel?: string;
  /** 入口 requestId，仅当 prompt 来自一次请求时存在。 */
  requestId?: string;
}

/** tracker 读取的 SDK 事件子集。 */
export interface AgentRunEventLike {
  type: string;
  /** `turn_end` 的 assistant message。 */
  message?: unknown;
  /** `agent_end` 中最后一轮的消息。 */
  messages?: readonly unknown[];
  /** 为 false 时表示会先恢复会话，尚未真正结束。 */
  isTerminal?: boolean;
  /** 为 false 时表示 agent 仍在继续自身工作（retry、compaction、提醒）。 */
  yielded?: boolean;
}

export interface AgentRunOutcome {
  stopReason?: AgentRunStopReason;
  error?: unknown;
}

export interface AgentRunCommandResult {
  ok: boolean;
  durationMs: number;
  cancelled?: boolean;
  newSessionId?: string;
  error?: unknown;
}

export interface AgentRunTrackerOptions {
  /** 当前 session id；fork 把包装器换到另一个会话时会随之变化。 */
  sessionId?: () => string | undefined;
  /** 单调时钟，单位毫秒。 */
  now?: () => number;
  newRunId?: () => string;
}

interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

interface TurnSummary {
  stopReason?: string;
  provider?: string;
  model?: string;
  usage?: TokenTotals;
}

interface ActiveRun {
  runId: string;
  sessionId: string;
  startedAt: number;
  start: AgentRunStart;
  turns: number;
  tokens?: TokenTotals;
  stopReason?: string;
  provider?: string;
  model?: string;
}

function definedFields(fields: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function readCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readUsage(value: unknown): TokenTotals | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const input = readCount(usage.input);
  const output = readCount(usage.output);
  const cacheRead = readCount(usage.cacheRead);
  const cacheWrite = readCount(usage.cacheWrite);
  if (input === undefined && output === undefined && cacheRead === undefined && cacheWrite === undefined) {
    return undefined;
  }
  return {
    input: input ?? 0,
    output: output ?? 0,
    cacheRead: cacheRead ?? 0,
    cacheWrite: cacheWrite ?? 0,
  };
}

/**
 * 只读取 assistant message 的生命周期摘要。消息里的文本、thinking、
 * tool call 及其参数全部忽略。
 */
function readTurnSummary(message: unknown): TurnSummary | undefined {
  if (!message || typeof message !== "object") return undefined;
  const candidate = message as Record<string, unknown>;
  if (candidate.role !== "assistant") return undefined;

  const summary = definedFields({
    stopReason: typeof candidate.stopReason === "string" ? candidate.stopReason : undefined,
    provider: typeof candidate.provider === "string" ? candidate.provider : undefined,
    model: typeof candidate.model === "string" ? candidate.model : undefined,
    usage: readUsage(candidate.usage),
  }) as TurnSummary;

  return Object.keys(summary).length > 0 ? summary : undefined;
}

function addTokens(target: TokenTotals, usage: TokenTotals): void {
  target.input += usage.input;
  target.output += usage.output;
  target.cacheRead += usage.cacheRead;
  target.cacheWrite += usage.cacheWrite;
}

/**
 * 会话当前模型的角色：omp 每次切换模型都会追加一条 `model_change` 记录，
 * 最新一条的 role 就是驱动会话的角色。
 */
export function resolveSessionModelRole(
  entries: ReadonlyArray<{ type?: string; role?: string }>,
): string {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "model_change") continue;
    return entry.role && entry.role.length > 0 ? entry.role : "default";
  }
  return "default";
}

/** 触发当前代码的请求 id；没有请求上下文时不编造。 */
export function currentRequestId(): string | undefined {
  const requestId = getLogContext()?.requestId;
  return typeof requestId === "string" && requestId.length > 0 ? requestId : undefined;
}

function endLevel(stopReason: AgentRunStopReason): LogLevel {
  if (stopReason === "error") return "error";
  if (stopReason === "aborted" || stopReason === "fork") return "warn";
  return "info";
}

export class AgentRunTracker {
  private readonly now: () => number;
  private readonly newRunId: () => string;
  private readonly sessionIdOf: (() => string | undefined) | undefined;
  private active: ActiveRun | undefined;

  constructor(options: AgentRunTrackerOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.newRunId = options.newRunId ?? (() => randomUUID());
    this.sessionIdOf = options.sessionId;
  }

  /** 当前在途 prompt 的 run id；没有在途运行时为 undefined。 */
  get activeRunId(): string | undefined {
    return this.active?.runId;
  }

  /** 为被接受的 prompt 开启一次运行，返回 `agent.run.start` 记录。 */
  begin(start: AgentRunStart): AgentRunRecord[] {
    const records: AgentRunRecord[] = [];
    if (this.active) {
      // 同一会话同时只允许一次 prompt 持有运行；重叠的 begin 说明上一次运行
      // 没有正常收尾，先把它关掉再开新的。
      records.push(...this.end({ stopReason: "aborted" }, { superseded: true }));
    }

    const run: ActiveRun = {
      runId: this.newRunId(),
      sessionId: start.sessionId,
      startedAt: this.now(),
      start,
      turns: 0,
    };
    this.active = run;
    records.push({
      level: "info",
      message: AGENT_RUN_START,
      fields: definedFields({
        sessionId: run.sessionId,
        runId: run.runId,
        provider: start.provider,
        model: start.model,
        role: start.role,
        thinkingLevel: start.thinkingLevel,
        configuredThinkingLevel: start.configuredThinkingLevel,
        requestId: start.requestId,
      }),
    });
    return records;
  }

  /**
   * 消费一个 SDK 事件。只有轮次边界与真正的 agent 结束有意义，
   * token 增量、工具执行与消息更新一律忽略。
   */
  push(event: AgentRunEventLike): AgentRunRecord[] {
    const run = this.active;
    if (!run) return [];

    if (event.type === "turn_end") {
      const summary = readTurnSummary(event.message);
      if (!summary) return [];
      run.turns += 1;
      this.applySummary(run, summary, true);
      return [];
    }

    if (event.type !== "agent_end") return [];

    if (run.turns === 0) {
      for (const message of event.messages ?? []) {
        const summary = readTurnSummary(message);
        if (summary) this.applySummary(run, summary, true);
      }
    } else {
      // 最后一轮已经在 turn_end 计过 usage，这里只补 stopReason，避免重复计数。
      for (const message of event.messages ?? []) {
        const summary = readTurnSummary(message);
        if (summary) this.applySummary(run, summary, false);
      }
    }

    if (event.isTerminal === false || event.yielded === false) return [];
    return this.end();
  }

  /** 结束当前运行；没有在途运行时什么也不做。 */
  finish(outcome: AgentRunOutcome = {}): AgentRunRecord[] {
    return this.end(outcome);
  }

  /** 记录一次命令结果，不包含命令文本、参数或消息内容。 */
  command(name: AgentRunCommand, result: AgentRunCommandResult): AgentRunRecord[] {
    const sessionId = this.active?.sessionId ?? this.sessionIdOf?.();
    return [{
      level: result.ok ? "info" : "warn",
      message: AGENT_RUN_COMMAND,
      fields: definedFields({
        sessionId,
        runId: this.active?.runId,
        command: name,
        ok: result.ok,
        durationMs: Math.max(0, Math.round(result.durationMs)),
        cancelled: result.cancelled,
        newSessionId: result.newSessionId,
        error: result.error,
      }),
    }];
  }

  private applySummary(run: ActiveRun, summary: TurnSummary, accumulateUsage: boolean): void {
    if (accumulateUsage && summary.usage) {
      run.tokens ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      addTokens(run.tokens, summary.usage);
    }
    if (summary.stopReason) run.stopReason = summary.stopReason;
    if (summary.provider) run.provider = summary.provider;
    if (summary.model) run.model = summary.model;
  }

  private end(outcome: AgentRunOutcome = {}, extra: Record<string, unknown> = {}): AgentRunRecord[] {
    const run = this.active;
    if (!run) return [];
    this.active = undefined;

    const stopReason = (outcome.stopReason ?? run.stopReason ?? "unknown") as AgentRunStopReason;
    const durationMs = Math.max(0, Math.round(this.now() - run.startedAt));
    const tokens = run.tokens;

    return [{
      level: endLevel(stopReason),
      message: AGENT_RUN_END,
      fields: definedFields({
        sessionId: run.sessionId,
        runId: run.runId,
        provider: run.provider ?? run.start.provider,
        model: run.model ?? run.start.model,
        role: run.start.role,
        thinkingLevel: run.start.thinkingLevel,
        configuredThinkingLevel: run.start.configuredThinkingLevel,
        durationMs,
        stopReason,
        turns: run.turns,
        inputTokens: tokens?.input,
        outputTokens: tokens?.output,
        cacheReadTokens: tokens?.cacheRead,
        cacheWriteTokens: tokens?.cacheWrite,
        totalTokens: tokens
          ? tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite
          : undefined,
        requestId: run.start.requestId,
        failed: outcome.error === undefined ? undefined : true,
        error: outcome.error,
        ...extra,
      }),
    }];
  }
}

/** 通过共享的 ompdesk 进程日志写入 tracker 记录。 */
export function writeAgentRunRecords(records: readonly AgentRunRecord[]): void {
  for (const record of records) {
    logEvent(record.level, "agent", record.message, record.fields);
  }
}
