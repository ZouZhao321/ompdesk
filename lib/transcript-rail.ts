import type { TranscriptItem } from "./transcript-items";

/** 跳转条车道的宽度（px）：贴在对话列右外侧。 */
export const RAIL_WIDTH_PX = 36;
/** 对话版心宽度（px）：与 components/ChatWindow.tsx 的行盒同源。 */
export const RAIL_COLUMN_WIDTH_PX = 820;
/** 版心内边距（px）：行盒两侧各留一份，与 ChatWindow 的 CHAT_COLUMN_PADDING 同源。 */
export const RAIL_COLUMN_PADDING_PX = 16;
/** 跳转条左缘与对话列右边缘之间的缝隙（px）。 */
export const RAIL_COLUMN_GAP_PX = 6;
/** 跳转条右缘与转写区右边缘之间的最小留白（px）。 */
export const RAIL_EDGE_MARGIN_PX = 4;
/** 跳转条左缘相对转写区中线的偏移（px）：版心一半 + 内边距 + 缝隙。 */
export const RAIL_INSET_PX = RAIL_COLUMN_WIDTH_PX / 2 + RAIL_COLUMN_PADDING_PX + RAIL_COLUMN_GAP_PX;
/**
 * 放得下整条跳转区的最小转写区宽度（px）：中线到跳转条左缘的偏移、车道与右边缘
 * 留白在两侧对称出现，右侧那半边正好是这三段之和。
 */
export const RAIL_MIN_REGION_PX = 2 * (RAIL_INSET_PX + RAIL_WIDTH_PX + RAIL_EDGE_MARGIN_PX);
/**
 * 车道容器隐藏的容器查询上限（px）：宽度不超过它即收起。容器查询的条件里写不了
 * calc，只能写字面量，所以这里取「最小宽度减一」——转写区宽度恰好等于最小宽度时
 * 仍然放得下。
 */
export const RAIL_LANE_QUERY_MAX_PX = RAIL_MIN_REGION_PX - 1;
/** 相邻圆点的中心距（px）：圆点 6px、间隙 8px，圆点列表按它换算滚动位置。 */
export const RAIL_ROW_PX = 14;
/** 圆点容器的最高高度（px），超出后容器内部滚动。 */
export const RAIL_MAX_HEIGHT_PX = 180;
/** 悬停提示里保留的提问字符数，超出由两行省略收起。 */
export const RAIL_PROMPT_CHARS = 160;

/** 跳转条在转写区里的落位：左右缘相对中线的偏移（向右为正），以及是否还放得下。 */
export interface TranscriptRailPlacement {
  visible: boolean;
  left: number;
  right: number;
}

/**
 * 按转写区宽度算跳转条的落位，与 app/globals.css 的 .transcript-rail 同一套算式：
 * 放不下整条车道就整条隐藏；放得下时左缘钉在对话列右侧的缝隙上，右缘与转写区
 * 右边缘至少留 RAIL_EDGE_MARGIN_PX。
 */
export function placeTranscriptRail(regionWidth: number): TranscriptRailPlacement {
  const center = regionWidth / 2;
  const visible = regionWidth > RAIL_LANE_QUERY_MAX_PX;
  // 跳转条右缘相对转写区右边缘的位置：中线减去左缘偏移与车道宽，车道刚够时正好等于最小留白。
  const edge = Math.max(RAIL_EDGE_MARGIN_PX, center - RAIL_INSET_PX - RAIL_WIDTH_PX);
  return { visible, left: center - edge - RAIL_WIDTH_PX, right: center - edge };
}

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
 * 当前圆点：条目下标不超过顶部可见条目的最后一个。
 *
 * 顶部可见条目落在第一个提问之前时返回 -1，此时不高亮任何圆点。页首插槽不是
 * 条目，顶部停在页首时顶部可见条目就是第一条数据项；它本身是提问锚点时高亮它，
 * 列表顶部没有被隐藏的提问。
 */
export function railCurrentDotIndex(dots: readonly TranscriptRailDot[], topItemIndex: number): number {
  let current = -1;
  for (let index = 0; index < dots.length; index += 1) {
    if (dots[index].itemIndex > topItemIndex) break;
    current = index;
  }
  return current;
}

/**
 * 圆点容器的内部滚动位置：把当前圆点放到容器正中，再夹回内容范围。
 *
 * 行高是圆点的节距，圆点在行内垂直居中，圆心因此在行高的一半处。内容高度由
 * 固定行高乘圆点数得出，容器高度是圆点列的可见高度（调用方读实际 clientHeight，
 * 上下两条按钮挤占后它比上限值小）。只有当前圆点变化才重算，滚动位置不随列表
 * 滚动抖动。
 */
export function railScrollTop(currentDotIndex: number, dotCount: number, containerHeight: number): number {
  if (dotCount <= 0 || containerHeight <= 0) return 0;
  const contentHeight = dotCount * RAIL_ROW_PX;
  const maxScroll = Math.max(contentHeight - containerHeight, 0);
  if (maxScroll === 0) return 0;
  const index = Math.min(Math.max(currentDotIndex, 0), dotCount - 1);
  const dotCenter = index * RAIL_ROW_PX + RAIL_ROW_PX / 2;
  return Math.min(Math.max(dotCenter - containerHeight / 2, 0), maxScroll);
}

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
