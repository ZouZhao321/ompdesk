import type { TranscriptItem } from "./transcript-items";

/** 对话版心宽度（px）：行盒宽度由它给出，app/globals.css 的 --chat-column-width 与它同值。 */
export const RAIL_COLUMN_WIDTH_PX = 820;
/** 版心内边距（px）：行盒两侧各留一份，app/globals.css 的 --chat-column-padding 与它同值。 */
export const RAIL_COLUMN_PADDING_PX = 16;
/**
 * 相邻圆点的中心距上限（px），也是每条提问在空间足够时的命中区高度。
 *
 * 圆点列铺满上下两条按钮之间的可用高度：圆点多到放不下时按数量压缩节距，
 * 所有提问始终各占一个可见圆点，与提问一一对应。节距取紧凑的 14px，命中区
 * 高度跟随节距，不为了放大命中区把整列撑开。
 */
export const RAIL_ROW_PX = 14;
/** 悬停提示里保留的提问字符数，超出由两行省略收起。 */
const RAIL_PROMPT_CHARS = 160;

/** 跳转条上的一个圆点。 */
export interface TranscriptRailDot {
  /** 条目下标：点击时直接交给列表定位，不换算成像素。 */
  itemIndex: number;
  /** 悬停提示文本：该轮提问的开头。 */
  prompt: string;
}

/** 列表报告的已渲染条目：下标、距条目数组顶部的偏移与测量高度。 */
export interface RailRenderedItem {
  index: number;
  offset: number;
  size: number;
}

/**
 * 圆点列表：每条带提问的锚点轮一个圆点。
 *
 * 分组结果直接来自条目数组，这里只挑锚点并取提问原文，不重新扫描消息判定
 * 轮次。取不到提问文本的锚点不出圆点：压缩摘要顶替了原提问，那不是用户的提问。
 */
export function buildTranscriptRailDots(
  items: readonly TranscriptItem[],
  promptOf: (item: TranscriptItem) => string | null,
): TranscriptRailDot[] {
  const dots: TranscriptRailDot[] = [];
  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex];
    if (!item.isAnchor || item.anchorIndex < 0) continue;
    const prompt = previewPrompt(promptOf(item));
    if (prompt === null) continue;
    dots.push({ itemIndex, prompt });
  }
  return dots;
}

function previewPrompt(prompt: string | null): string | null {
  const text = prompt?.trim();
  if (!text) return null;
  return Array.from(text).slice(0, RAIL_PROMPT_CHARS).join("");
}

/**
 * 当前圆点：贴底时是最后一个，否则是条目下标不超过顶部可见条目的最后一个。
 *
 * 最后一段内容比视口短时，停在底部也会发现视口顶边落在上一轮里；高亮跟着顶部
 * 可见条目走就会停在倒数第二个，所以贴底单独给最后一个圆点。贴底判据与跟随、
 * 「回到底部」按钮共用 `FOLLOW_BOTTOM_THRESHOLD_PX`。
 *
 * 顶部可见条目落在第一个提问之前时返回 -1，此时不高亮任何圆点。页首插槽不是
 * 条目，顶部停在页首时顶部可见条目就是第一条数据项；它本身是提问锚点时高亮它，
 * 列表顶部没有被隐藏的提问。
 */
export function railCurrentDotIndex(
  dots: readonly TranscriptRailDot[],
  topItemIndex: number,
  atBottom: boolean,
): number {
  if (dots.length === 0) return -1;
  if (atBottom) return dots.length - 1;
  let current = -1;
  for (let index = 0; index < dots.length; index += 1) {
    if (dots[index].itemIndex > topItemIndex) break;
    current = index;
  }
  return current;
}

/**
 * 圆点列的行高：把全部圆点铺进可用高度，上限是 `RAIL_ROW_PX`。
 *
 * 圆点数少于可放数量时保持 14px 节距；多到放不下时按数量均分。均分后低于
 * `RAIL_MIN_PITCH_PX` 时返回 null，调用方收起整条跳转条——节距再小既点不中，
 * 圆点也会叠成一条实线。
 */
export function railDotPitch(availableHeight: number, dotCount: number): number | null {
  if (dotCount <= 0 || availableHeight <= 0) return RAIL_ROW_PX;
  const pitch = Math.min(RAIL_ROW_PX, availableHeight / dotCount);
  return pitch < RAIL_MIN_PITCH_PX ? null : pitch;
}

/** 圆点列能接受的最小节距（px）：再小就没有可用的命中区，跳转条整体收起。 */
export const RAIL_MIN_PITCH_PX = 6;

/** 逐轮跳转的方向：-1 上一条，1 下一条。 */
export type RailStepDirection = -1 | 1;

/**
 * 上一条或下一条提问的条目下标，到头或到尾返回 null。
 *
 * 当前没有圆点（顶部停在第一轮之前）时，下一条是第一个圆点，上一条没有目标；
 * 顶部落在两轮之间时，两侧取当前这一轮前后最近的圆点。
 */
export function railStepItemIndex(
  dots: readonly TranscriptRailDot[],
  currentDotIndex: number,
  direction: RailStepDirection,
): number | null {
  if (dots.length === 0) return null;
  if (direction > 0) {
    const next = currentDotIndex < 0 ? 0 : currentDotIndex + 1;
    return next < dots.length ? dots[next].itemIndex : null;
  }
  return currentDotIndex > 0 ? dots[currentDotIndex - 1].itemIndex : null;
}

/** 只有一轮提问时不显示跳转条。 */
export function shouldShowTranscriptRail(dotCount: number): boolean {
  return dotCount > 1;
}

/** 顶部判定容差（px）：行顶落在视口顶边下方一行以内时仍算顶部可见。 */
export const RAIL_TOP_SLACK_PX = 24;

/** 上下两条步进按钮的高度（px）：圆点列的可用高度按车道高度减去这个块算。 */
export const RAIL_STEP_HEIGHT_PX = 20;

/** 跳转条内部的行间距（px）：步进按钮与圆点列共用；与正文缝隙的 `--transcript-rail-gap` 无关。 */
export const RAIL_ROW_GAP_PX = 4;

/**
 * 顶部可见条目：偏移不超过可见顶边的最后一条。
 *
 * 可见顶边是滚动容器顶边与条目列表顶边的距离，偏移与高度取自列表自己报告的
 * 已渲染条目，不按平均高度估算。可见顶边落在第一条之上（页首插槽可见）时返回
 * 第一条；列表还没渲染任何条目时返回 null。
 */
export function railTopVisibleItemIndex(
  items: readonly RailRenderedItem[],
  visibleTop: number,
): number | null {
  if (items.length === 0) return null;
  let top = items[0].index;
  for (const item of items) {
    if (item.offset > visibleTop) break;
    top = item.index;
  }
  return top;
}
