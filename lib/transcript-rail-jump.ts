/**
 * 跳转的待清算目标。
 *
 * 跳转先把条目下标交给列表，目标附近的行实测高度出来之后再对齐一次。对齐只有
 * 两条时机：列表报告停止滚动，或兜底定时器到期——点击已经在顶部的圆点不会产生
 * 滚动，等不到停止回调。两条时机共用同一份目标，先到的那条清算，另一条什么都
 * 不做。
 */

/** 兜底时长（ms）：这时不管有没有发生滚动，待清算目标都作废。 */
export const RAIL_JUMP_SETTLE_MS = 300;

/** 一次跳转的状态：`pending` 是还没重新对齐的条目下标。 */
export interface RailJumpState {
	readonly pending: number | null;
}

/** 没有待清算目标的初始状态。 */
export const RAIL_JUMP_IDLE: RailJumpState = { pending: null };

/** 清算结果：需要重新对齐的条目下标，以及清算之后的状态。 */
export interface RailJumpSettlement {
	/** 需要按实测高度重新对齐的条目下标；没有待清算目标时为 null。 */
	readonly realign: number | null;
	/** 写回调用方保存的下一次状态。 */
	readonly state: RailJumpState;
}

/** 清算一次跳转：同一次跳转只会给出一次重新对齐。 */
export function settleRailJump(state: RailJumpState): RailJumpSettlement {
	if (state.pending === null) return { realign: null, state: RAIL_JUMP_IDLE };
	return { realign: state.pending, state: RAIL_JUMP_IDLE };
}
