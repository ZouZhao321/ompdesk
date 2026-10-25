import type { SessionInfo, SessionStatus } from "./types";

/** 静态层接入的五种生命周期结果；判断不出来不产生静态标记。 */
export type StaticMarkerStatus = "complete" | "interrupted" | "aborted" | "error" | "pending";

/** 静态标记的展示信息：主题颜色与无障碍文字的 i18n key。 */
export interface StaticMarkerAppearance {
  /** 主题里的 CSS 颜色变量。 */
  color: string;
  /** 无障碍文字使用的 i18n key。 */
  labelKey: string;
}

/**
 * 侧栏标记。
 *
 * 动态层有两个子状态：正在处理、等你回答；静态层是最后一条消息的结果。
 * 动态层优先，所以任一动态子状态成立时不会返回静态标记。
 */
export type SessionMarker =
  | { kind: "running" }
  | { kind: "awaiting" }
  | { kind: "static"; status: StaticMarkerStatus };

/** resolveSessionMarker 的输入条件。 */
export interface SessionMarkerInput {
  /** 会话文件末尾推导出的最后状态；缺失视为判断不出来。 */
  status?: SessionStatus;
  /** 正在处理：此时只显示转圈。 */
  isRunning?: boolean;
  /** 运行中停在提问表单上等用户回答：此时显示等待圆环。 */
  isWaiting?: boolean;
  /** 该会话在当前浏览器里是否未读。 */
  isUnread: boolean;
}

/** 五种静态结果各自的主题颜色与无障碍文字。 */
export const STATIC_MARKER_APPEARANCE: Record<StaticMarkerStatus, StaticMarkerAppearance> = {
  complete: { color: "var(--success)", labelKey: "sidebar.sessionComplete" },
  interrupted: { color: "var(--warning)", labelKey: "sidebar.sessionInterrupted" },
  aborted: { color: "var(--text-muted)", labelKey: "sidebar.sessionAborted" },
  error: { color: "var(--danger)", labelKey: "sidebar.sessionError" },
  pending: { color: "var(--accent)", labelKey: "sidebar.sessionPending" },
};

/** 把 omp 的最后状态收窄成静态标记支持的结果。 */
function isStaticMarkerStatus(status: SessionStatus | undefined): status is StaticMarkerStatus {
  return status !== undefined && status !== "unknown";
}

/**
 * 判定顺序：等你回答 → 正在处理 → 未读且状态属于五种结果 → 无标记。
 *
 * 等你回答与正在处理可能同时成立（表单等待本身就是运行中的一段），此时只返回
 * 等你回答，回答完之后自然落回正在处理。动态状态优先，所以运行期间读不读都
 * 挡掉静态标记。
 */
export function resolveSessionMarker(input: SessionMarkerInput): SessionMarker | null {
  if (input.isWaiting) return { kind: "awaiting" };
  if (input.isRunning) return { kind: "running" };
  if (!input.isUnread) return null;
  if (!isStaticMarkerStatus(input.status)) return null;
  return { kind: "static", status: input.status };
}

/**
 * 首次加载时应当加入未读集合的会话 id。
 *
 * 只为「现在就能显示静态标记、且没有在跑」的异常会话播种：中断、用户取消、
 * 报错、待回复。正常完成留给后台完成提醒，判断不出来不标记。已读状态由调用方
 * 保证只播种一次，这里一律按「还没读过」处理。
 */
export function initialMarkerUnreadIds(
  sessions: readonly SessionInfo[],
  runningSessionIds: ReadonlySet<string>,
  waitingSessionIds: ReadonlySet<string>,
): string[] {
  return sessions
    .filter((session) => {
      const marker = resolveSessionMarker({
        status: session.status,
        isRunning: runningSessionIds.has(session.id),
        isWaiting: waitingSessionIds.has(session.id),
        isUnread: true,
      });
      return marker?.kind === "static" && marker.status !== "complete";
    })
    .map((session) => session.id);
}

/** 一次运行结束时的归属条件：决定这次结束是否写进未读集合。 */
export interface TaskEndAttribution {
  /** 结束的是不是当前选中的会话。 */
  isSelected: boolean;
  /** 结束发生时页面是否可见。 */
  isPageVisible: boolean;
  /** 结束是否由 omp 进程退出造成：进程退出没有可观察的完成时刻。 */
  isProcessExit?: boolean;
}

/**
 * 任务结束时是否把会话记为未读。
 *
 * 用户正看着的会话算已读；页面在后台、或结束的是别的会话时要亮标记。
 * 进程退出属于例外：页面没有机会看到结束的那一刻，一律记为未读。
 */
export function shouldMarkSessionUnread(input: TaskEndAttribution): boolean {
  if (input.isProcessExit) return true;
  return !input.isSelected || !input.isPageVisible;
}

/** 相邻两份活动快照的对比输入。 */
export interface FinishedRunsInput {
  /** 上一份快照里正在运行的会话。 */
  previousRunningSessionIds: readonly string[];
  /** 当前快照里仍在运行的会话。 */
  runningSessionIds: ReadonlySet<string>;
  /** 上一份快照的 runtime → 会话 id 映射。 */
  previousSessionIdsByRuntimeId?: Record<string, string>;
  /** 当前快照的 runtime → 会话 id 映射。 */
  sessionIdsByRuntimeId?: Record<string, string>;
  selectedSessionId?: string | null;
  selectedRuntimeId?: string;
  /** 本次对比覆盖的时间段内页面是否始终可见。 */
  isPageVisible: boolean;
  /** 本次对比覆盖的时间段内是否与服务失去过联系。 */
  isProcessExit?: boolean;
}

/** 两份快照之间结束的运行，以及每个结束各自的归属。 */
export interface FinishedRuns {
  /** 按当前会话 id 表示并去重后的结束列表。 */
  finishedIds: string[];
  /** 其中要写入未读集合的会话。 */
  unreadIds: string[];
  /** 其中不是当前选中的会话，用于后台完成提醒。 */
  backgroundIds: string[];
}

/**
 * 对比相邻两份活动快照，算出哪些运行结束了、这次结束归谁。
 *
 * 会话 id 可能在运行中变化，所以用 runtime id 把上一份快照的运行换算成当前 id，
 * 并以 runtime id 判断它是不是选中的那次运行。
 */
export function resolveFinishedRuns(input: FinishedRunsInput): FinishedRuns {
  const selectedCanonicalId = input.selectedRuntimeId
    ? input.sessionIdsByRuntimeId?.[input.selectedRuntimeId] ?? input.selectedSessionId ?? null
    : input.selectedSessionId ?? null;
  const previousRuntimeIds = new Map(
    Object.entries(input.previousSessionIdsByRuntimeId ?? {})
      .map(([runtimeId, sessionId]) => [sessionId, runtimeId]),
  );

  const finishedIds: string[] = [];
  for (const id of input.previousRunningSessionIds) {
    const runtimeId = previousRuntimeIds.get(id);
    if (runtimeId !== undefined && runtimeId === input.selectedRuntimeId) continue;
    const currentId = (runtimeId === undefined ? undefined : input.sessionIdsByRuntimeId?.[runtimeId]) ?? id;
    if (input.runningSessionIds.has(currentId) || finishedIds.includes(currentId)) continue;
    finishedIds.push(currentId);
  }

  const unreadIds = finishedIds.filter((id) => shouldMarkSessionUnread({
    isSelected: id === selectedCanonicalId,
    isPageVisible: input.isPageVisible,
    isProcessExit: input.isProcessExit,
  }));
  const backgroundIds = finishedIds.filter((id) => id !== selectedCanonicalId);

  return { finishedIds, unreadIds, backgroundIds };
}
