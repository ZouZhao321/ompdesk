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
  /** 记下取回的延迟内容；正文本身就是「已加载」的标记，写入不通知订阅方。 */
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

/** 一个视图仓库保存的条目上限：超出后按最早写入淘汰。 */
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

  function write(key: string, state: EntryViewState): void {
    entries.set(key, state);
    // Map 保持插入顺序：超出上限时从最早写入的那条开始淘汰。
    while (entries.size > MAX_VIEW_ENTRIES) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }
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
      // 的订阅者是所有已挂载的工具块，一条延迟正文取回不该让它们全部重渲染。
      write(key, { ...current, content });
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
