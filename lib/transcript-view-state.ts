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
  /** 记下取回的延迟内容；正文本身就是「已加载」的标记。 */
  markLoaded(sessionId: string | undefined, anchorEntryId: string | undefined, part: string, content: string): void;
  /** 已取回的延迟内容；还没取回时为 null。 */
  loadedContent(sessionId: string | undefined, anchorEntryId: string | undefined, part: string): string | null;
}

// ASCII 单元分隔符不会出现在 entryId 或部位标识里。
const KEY_SEPARATOR = "\u001f";

// 还没落盘的新会话没有 id，统一落到同一个空会话桶里。
function entryKey(sessionId: string | undefined, anchorEntryId: string | undefined, part: string): string {
  return [sessionId ?? "", anchorEntryId ?? "", part].join(KEY_SEPARATOR);
}

/**
 * 建一个视图状态仓库。会话之间彼此隔离；会话被删除后遗留的键随进程生命周期
 * 自然过期，不做显式清理。
 */
export function createTranscriptViewStore(): TranscriptViewStore {
  const entries = new Map<string, EntryViewState>();
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const listener of [...listeners]) listener();
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
      entries.set(key, { ...entries.get(key), expanded: !current });
      emit();
    },
    markLoaded(sessionId, anchorEntryId, part, content) {
      const key = entryKey(sessionId, anchorEntryId, part);
      const current = entries.get(key);
      // 同一段正文再标记一次不通知订阅方：思考块加载完不该触发整段转写重渲染。
      if (current?.content === content) return;
      entries.set(key, { ...current, content });
      emit();
    },
    loadedContent(sessionId, anchorEntryId, part) {
      return entries.get(entryKey(sessionId, anchorEntryId, part))?.content ?? null;
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
