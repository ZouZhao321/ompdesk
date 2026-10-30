"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * 一轮里可折叠或可延迟加载的界面部件。键由“本轮提问锚点的 entryId + 部位标识”
 * 组成，因此部位标识只需在同一轮内唯一。
 */
export const PROCESS_DETAILS_PART = "process";

export function toolCallPart(toolCallId: string): string {
  return `tool:${toolCallId}`;
}

export function thinkingPart(entryId: string, blockIndex: number): string {
  return `thinking:${entryId}:${blockIndex}`;
}

interface EntryViewState {
  expanded?: boolean;
  /** 延迟内容的正文：与「已加载」标记一起留着，条目重建的首帧直接渲染。 */
  content?: string;
}

export interface TranscriptViewStore {
  subscribe(listener: () => void): () => void;
  /** 读出展开状态；没有用户操作记录时返回 `fallback`。 */
  isExpanded(sessionId: string | undefined, anchorEntryId: string | undefined, part: string, fallback: boolean): boolean;
  toggleExpanded(sessionId: string | undefined, anchorEntryId: string | undefined, part: string, fallback: boolean): void;
  /** 记下取回的延迟内容；正文本身就是「已加载」的标记，写入通常不通知订阅方。 */
  markLoaded(sessionId: string | undefined, anchorEntryId: string | undefined, part: string, content: string): void;
  /** 已取回的延迟内容；还没取回时为 null。 */
  loadedContent(sessionId: string | undefined, anchorEntryId: string | undefined, part: string): string | null;
  /** 只留下这个会话的条目；切到别的会话后上一会话的正文与展开状态不再需要。 */
  retainSession(sessionId: string | undefined): void;
  /** 丢掉这个会话的条目：会话被删除后它的正文不该继续占着内存。 */
  forgetSession(sessionId: string | undefined): void;
}

// ASCII 单元分隔符不会出现在 entryId 或部位标识里。
const KEY_SEPARATOR = "\u001f";

/** 一个视图仓库保存的条目上限：超出后按写入顺序淘汰最久没写过的条目，优先只带正文的。 */
export const MAX_VIEW_ENTRIES = 1000;

// 还没落盘的新会话没有 id，统一落到同一个空会话桶里。
function entryKey(sessionId: string | undefined, anchorEntryId: string | undefined, part: string): string {
  return [sessionId ?? "", anchorEntryId ?? "", part].join(KEY_SEPARATOR);
}

/**
 * 建一个视图状态仓库。会话之间彼此隔离；条目按会话成桶清理，整体另有数量上限，
 * 长会话不会让延迟正文无限堆积。
 */
export function createTranscriptViewStore(): TranscriptViewStore {
  const entries = new Map<string, EntryViewState>();
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const listener of [...listeners]) listener();
  }

  /**
   * 淘汰一条，`keep` 是刚写入的键、不参与本轮的挑选。优先丢掉写入顺序上最久的那条
   * 只带正文的条目：展开状态是用户的选择，正文按需重新取回。返回丢掉的是哪一类，
   * 写入方据此决定要不要通知订阅方。
   */
  function evictOne(keep: string): "empty" | "content" | "expanded" {
    let contentOnly: string | null = null;
    let oldest: string | null = null;
    for (const [key, state] of entries) {
      if (key === keep) continue;
      if (oldest === null) oldest = key;
      if (state.expanded === undefined) {
        contentOnly = key;
        break;
      }
    }
    const victim = contentOnly ?? oldest;
    if (victim === null) return "empty";
    const victimCarriesExpanded = entries.get(victim)?.expanded !== undefined;
    entries.delete(victim);
    return victimCarriesExpanded ? "expanded" : "content";
  }

  /**
   * 写入并维持上限。已有键先删后写：Map 的插入顺序因此就是写入顺序，最近写过的那条
   * 不会因为「写得早」被当成最久没用的。读取不刷新顺序——读发生在渲染期，不在渲染里
   * 改仓库；淘汰只看写入。返回淘汰是否丢了展开状态——那时已挂载的订阅方快照已经过期，
   * 写入方要补一次通知。
   */
  function write(key: string, state: EntryViewState): boolean {
    entries.delete(key);
    entries.set(key, state);
    let droppedExpanded = false;
    while (entries.size > MAX_VIEW_ENTRIES) {
      const evicted = evictOne(key);
      if (evicted === "empty") break;
      if (evicted === "expanded") droppedExpanded = true;
    }
    return droppedExpanded;
  }

  function dropWhere(predicate: (key: string) => boolean): void {
    let dropped = false;
    for (const key of entries.keys()) {
      if (!predicate(key)) continue;
      entries.delete(key);
      dropped = true;
    }
    if (dropped) emit();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isExpanded(sessionId, anchorEntryId, part, fallback) {
      return entries.get(entryKey(sessionId, anchorEntryId, part))?.expanded ?? fallback;
    },
    toggleExpanded(sessionId, anchorEntryId, part, fallback) {
      const key = entryKey(sessionId, anchorEntryId, part);
      const current = entries.get(key)?.expanded ?? fallback;
      write(key, { ...entries.get(key), expanded: !current });
      emit();
    },
    markLoaded(sessionId, anchorEntryId, part, content) {
      const key = entryKey(sessionId, anchorEntryId, part);
      const current = entries.get(key);
      if (current?.content === content) return;
      // 正文只服务下一次挂载的首帧，读者在渲染期直接取。这里不通知订阅方：展开状态
      // 的订阅者是所有已挂载的工具块，一条延迟正文取回不该让它们全部重渲染；只有
      // 淘汰顺手带走了展开状态时才补一次通知，否则那边的快照会停在旧值。
      if (write(key, { ...current, content })) emit();
    },
    loadedContent(sessionId, anchorEntryId, part) {
      return entries.get(entryKey(sessionId, anchorEntryId, part))?.content ?? null;
    },
    retainSession(sessionId) {
      // 还没落盘的新会话不知道下一次点击会落到哪一桶，先不动已存的状态。
      if (sessionId === undefined) return;
      // 分隔符不会出现在 id 里，前缀匹配因此没有歧义。
      const prefix = `${sessionId}${KEY_SEPARATOR}`;
      dropWhere((key) => !key.startsWith(prefix));
    },
    forgetSession(sessionId) {
      const prefix = `${sessionId ?? ""}${KEY_SEPARATOR}`;
      dropWhere((key) => key.startsWith(prefix));
    },
  };
}

/** 转写里共用的一份视图状态。 */
export const transcriptViewState = createTranscriptViewStore();

/** 延迟正文的下一步：渲染已取回的正文、按需请求，还是取不回来。 */
export type DeferredContentPlan =
  | { kind: "stored"; content: string }
  | { kind: "fetch"; sessionId: string; entryId: string }
  | { kind: "unavailable" };

/**
 * 延迟正文的行动计划。视图状态里已有正文就先渲染它——正文按 entryId 定位，与会话
 * id 无关，所以会话还没落盘也不会把正文换成错误文案；只有确实没有正文、又拿不到
 * 请求所需的会话 id 或 entryId 时才算取不回来。
 */
export function planDeferredContent(
  stored: string | null,
  sessionId: string | undefined,
  entryId: string | undefined,
): DeferredContentPlan {
  if (stored !== null) return { kind: "stored", content: stored };
  if (sessionId === undefined || entryId === undefined) return { kind: "unavailable" };
  return { kind: "fetch", sessionId, entryId };
}

function subscribeToViewState(listener: () => void): () => void {
  return transcriptViewState.subscribe(listener);
}

/**
 * 读取一轮里某个部件的展开状态。`defaultExpanded` 只在用户还没操作过该部件时生效，
 * 条目被虚拟列表卸载后重建仍然回到用户最后一次的选择。
 */
export function useTranscriptExpanded(
  sessionId: string | undefined,
  anchorEntryId: string | undefined,
  part: string,
  defaultExpanded: boolean,
): boolean {
  const getSnapshot = useCallback(
    () => transcriptViewState.isExpanded(sessionId, anchorEntryId, part, defaultExpanded),
    [sessionId, anchorEntryId, part, defaultExpanded],
  );
  const getServerSnapshot = useCallback(() => defaultExpanded, [defaultExpanded]);
  return useSyncExternalStore(subscribeToViewState, getSnapshot, getServerSnapshot);
}
