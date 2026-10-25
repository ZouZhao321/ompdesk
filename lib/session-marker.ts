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
