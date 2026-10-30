import type { AgentMessage } from "./types";
import type { TranscriptItem } from "./transcript-items";

/**
 * 列表末尾的合成项：正在流式输出的那条消息。
 *
 * 它还没有写进会话记录，没有 entryId，也就不能参与分组；但它必须和条目走同一套
 * 键与定位，否则流式气泡会落在列表外面，跟随、首屏定位都管不到它。
 */
export interface TranscriptLiveTailItem {
  /** 与 TranscriptItem 的判别字段区分开。 */
  kind: "live-tail";
  /** 列表键，固定值，与会话记录的 entryId 不同源。 */
  key: string;
  /** 流式消息；内容随后续数据块增长。 */
  message: Partial<AgentMessage>;
}

/** 列表消费的项：分组得到的条目，加上流式期间末尾的合成项。 */
export type TranscriptListItem = TranscriptItem | TranscriptLiveTailItem;

/** 合成项的键。会话记录的 entryId 不会等于这个值。 */
export const TRANSCRIPT_LIVE_TAIL_KEY = "transcript-live-tail";

export function isTranscriptLiveTailItem(item: TranscriptListItem): item is TranscriptLiveTailItem {
  return "kind" in item && item.kind === "live-tail";
}

/**
 * 合成项当前是否存在：数据表与键表都只从这里取判断。
 *
 * `agent_start` 之后、首个数据块之前 `isStreaming` 已经为真而消息还是空的。两处若各看
 * 一种判据，键表就会比数据表多一项，虚拟列表按下标取键随之错位。
 */
export function hasTranscriptLiveTail(
  streamingMessage: Partial<AgentMessage> | null | undefined,
): streamingMessage is Partial<AgentMessage> {
  return streamingMessage != null;
}

/**
 * 把流式消息接到条目数组末尾。
 *
 * 没有流式消息时原样返回条目数组，列表的数据引用不变；有流式消息时只新增末尾
 * 一项，前面的条目保持原对象，重绘范围由此收窄到这一项。
 */
export function withTranscriptLiveTail(
  items: readonly TranscriptItem[],
  streamingMessage: Partial<AgentMessage> | null,
): readonly TranscriptListItem[] {
  if (!hasTranscriptLiveTail(streamingMessage)) return items;
  return [
    ...items,
    { kind: "live-tail", key: TRANSCRIPT_LIVE_TAIL_KEY, message: streamingMessage },
  ];
}
