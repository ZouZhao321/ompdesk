import type { SessionInfo, SessionStatus } from "./types";

/** 静态层已接入的生命周期结果。本阶段只有「中断」，其余四种结果由后续改动接入。 */
export type StaticMarkerStatus = "interrupted";

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

/**
 * 判定顺序：等你回答 → 正在处理 → 未读且状态属于已接入的结果 → 无标记。
 *
 * 等你回答与正在处理可能同时成立（表单等待本身就是运行中的一段），此时只返回
 * 等你回答，回答完之后自然落回正在处理。动态状态优先，所以运行期间读不读都
 * 挡掉静态标记。
 */
export function resolveSessionMarker(input: SessionMarkerInput): SessionMarker | null {
  if (input.isWaiting) return { kind: "awaiting" };
  if (input.isRunning) return { kind: "running" };
  if (!input.isUnread) return null;
  if (input.status !== "interrupted") return null;
  return { kind: "static", status: "interrupted" };
}

/**
 * 首次加载时应当加入未读集合的会话 id。
 *
 * 只为「现在就能显示静态标记、且没有在跑」的会话播种，避免把正在运行的会话
 * 提前标成未读。已读状态由调用方保证只播种一次，这里一律按「还没读过」处理。
 */
export function initialMarkerUnreadIds(
  sessions: readonly SessionInfo[],
  runningSessionIds: ReadonlySet<string>,
  waitingSessionIds: ReadonlySet<string>,
): string[] {
  return sessions
    .filter(
      (session) =>
        resolveSessionMarker({
          status: session.status,
          isRunning: runningSessionIds.has(session.id),
          isWaiting: waitingSessionIds.has(session.id),
          isUnread: true,
        })?.kind === "static",
    )
    .map((session) => session.id);
}
