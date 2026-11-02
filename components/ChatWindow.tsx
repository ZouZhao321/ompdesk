"use client";
import { registerAbortHandler } from "@/hooks/useKeyboardShortcuts";
import { Fragment, createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import type {
  AgentMessage,
  BashExecutionMessage,
  BlockingExtensionUiRequest,
  ExtensionUiRequest,
  SessionInfo,
  SessionTreeNode,
  SubagentSnapshot,
  ToolResultMessage,
  UserMessage,
} from "@/lib/types";
import { normalizeCustomPanelLines, parseAnsiLine } from "@/lib/ansi";
import { asBracketedPaste, toTerminalKeyData } from "@/lib/terminal-input";
import { buildRewindEntries } from "@/lib/rewind";
import type { DisplayOptions } from "@/lib/message-display";
import type { WrittenFile } from "@/lib/turn-written-files";
import { buildTranscriptItems } from "@/lib/transcript-items";
import {
  buildTranscriptRailDots,
  railCurrentDotIndex,
  railTopVisibleItemIndex,
  shouldShowTranscriptRail,
  RAIL_COLUMN_PADDING_PX,
  RAIL_COLUMN_WIDTH_PX,
  type RailRenderedItem,
} from "@/lib/transcript-rail";
import { FOLLOW_BOTTOM_THRESHOLD_PX } from "@/lib/transcript-follow";
import { RAIL_JUMP_IDLE, RAIL_JUMP_SETTLE_MS, settleRailJump, type RailJumpState } from "@/lib/transcript-rail-jump";
import { buildVirtualTranscriptModel, transcriptFollowOutput } from "@/lib/transcript-virtual-list";
import {
  hasTranscriptLiveTail,
  isTranscriptLiveTailItem,
  TRANSCRIPT_LIVE_TAIL_KEY,
  withTranscriptLiveTail,
  type TranscriptListItem,
} from "@/lib/transcript-live-tail";
import { PROCESS_DETAILS_PART, transcriptViewState, useTranscriptExpanded } from "@/lib/transcript-view-state";
import { MessageView } from "./MessageView";
import { TranscriptRail } from "./TranscriptRail";
import { MarkdownBody } from "./MarkdownBody";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ExtensionStatusBar } from "./ExtensionStatusBar";
import { RewindDialog } from "./RewindDialog";
import { OmpWordmark } from "./OmpWordmark";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MOBILE_HIT_TARGET_PX } from "@/lib/mobile-layout";
import { useAgentSession, type AgentPhase, type NoticeItem } from "@/hooks/useAgentSession";
import { useSyncedDisplaySettings } from "@/hooks/useDisplaySettings";
import { formatTokenCount } from "@/lib/format-tokens";
import { useDragDrop } from "@/hooks/useDragDrop";
import type { GoalStatusInfo, SessionStatsInfo } from "@/lib/omp-types";
import { Virtuoso, type Components, type ListItem, type ListProps, type VirtuosoHandle } from "react-virtuoso";

interface Props {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: (sessionId?: string) => void;
  onAttentionNeeded?: (request: BlockingExtensionUiRequest) => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string, runtimeId?: string | null) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSessionStatsChange?: (stats: SessionStatsInfo | null) => void;
  onSessionStatsPanelOpen?: () => void;
  onContextUsageChange?: (usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => void;
  onOpenFile?: (filePath: string) => void;
  onSubagentsChange?: (subagents: SubagentSnapshot[]) => void;
  /** Completion sound state + controls, owned by AppShell so tasks finishing in
   *  a non-active workspace can still ring. */
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  playDoneSound?: () => void;
  unlockAudio?: () => void;
}

function phaseLabel(phase: AgentPhase, t: (key: string, params?: Record<string, string | number>) => string): string | null {
  if (phase?.kind === "running_tools") {
    const names = phase.tools.map((t) => t.name);
    if (names.length === 0) return t("chat.runningTool");
    if (names.length === 1) return t("chat.runningNamedTool", { name: names[0] });
    if (names.length <= 3) return t("chat.runningTools", { names: names.join(", ") });
    return t("chat.runningToolsMore", { names: names.slice(0, 2).join(", "), count: names.length - 2 });
  }
  if (phase?.kind === "waiting_model") return t("chat.waitingModel");
  if (phase?.kind === "running_command") return t("chat.runningCommand");
  return null;
}

const CHAT_COLUMN_PADDING = RAIL_COLUMN_PADDING_PX;

/**
 * 虚拟列表里每一行（页首、条目、页尾）共用的版心，等价于改造前滚动手写容器
 * 那层 `padding: 0 16px` + `maxWidth 820 margin auto`。
 */
const TRANSCRIPT_ROW_STYLE: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  minWidth: 0,
  maxWidth: RAIL_COLUMN_WIDTH_PX + CHAT_COLUMN_PADDING * 2,
  margin: "0 auto",
  padding: `0 ${CHAT_COLUMN_PADDING}px`,
};

interface TranscriptSlotsContext {
  header: ReactNode;
  footer: ReactNode;
}

/**
 * 列表容器的 ref 单独走一份 context：Virtuoso 的渲染 context 只放插槽内容，
 * 跳转条需要列表容器本身的位置来换算顶部可见条目。
 */
const TranscriptListRefContext = createContext<RefObject<HTMLDivElement | null> | null>(null);

/**
 * 视口上下各预留 400px：快速滚动时先有内容，挂载量仍是一屏加固定缓冲，
 * 与会话总长度无关。
 */
const TRANSCRIPT_VIEWPORT_BUFFER = { top: 400, bottom: 400 };

/**
 * 列表之外的部件走列表提供的页首/页尾插槽，仍然在同一条滚动流里。
 * 插槽组件定义在模块作用域，身份不变；内容更新走 context，插槽不会被卸载重挂。
 */
function TranscriptHeaderSlot({ context }: { context?: TranscriptSlotsContext }) {
  return <>{context?.header}</>;
}

function TranscriptFooterSlot({ context }: { context?: TranscriptSlotsContext }) {
  return <>{context?.footer}</>;
}

/**
 * 列表容器自己画：Virtuoso 的测量 ref 与跳转条的位置 ref 一起挂上。
 * 只透传 `ListProps` 里的三个属性，渲染 context 不落到 DOM 上。
 */
function TranscriptListSlot({ ref: measurementRef, "data-testid": testId, style, children }: ListProps) {
  const railListRef = useContext(TranscriptListRefContext);
  const attach = useCallback((node: HTMLDivElement | null) => {
    if (typeof measurementRef === "function") measurementRef(node);
    else if (measurementRef) measurementRef.current = node;
    if (railListRef) railListRef.current = node;
  }, [measurementRef, railListRef]);
  return <div data-testid={testId} style={style} ref={attach}>{children}</div>;
}

const TRANSCRIPT_SLOTS: Components<TranscriptListItem, TranscriptSlotsContext> = {
  Header: TranscriptHeaderSlot,
  Footer: TranscriptFooterSlot,
  List: TranscriptListSlot,
};

function getUserInputText(message: AgentMessage): string | null {
  if (message.role !== "user") return null;
  if (typeof message.content === "string") {
    const text = message.content.trim();
    return text.length > 0 ? text : null;
  }
  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}

function ProcessDetailsGroup({ messageCount, toolCallCount, defaultExpanded = false, sessionId, anchorEntryId, children, t }: { messageCount: number; toolCallCount: number; defaultExpanded?: boolean; sessionId?: string; anchorEntryId: string; children: ReactNode; t: (key: string, params?: Record<string, string | number>) => string }) {
  // 展开状态存在转写视图状态里，虚拟列表卸载本组后重建仍保留用户的选择。
  const expanded = useTranscriptExpanded(sessionId, anchorEntryId, PROCESS_DETAILS_PART, defaultExpanded);
  const parts = [t("chat.processDetails"), `${messageCount} ${t(messageCount === 1 ? "chat.message" : "chat.messages")}`];
  if (toolCallCount > 0) parts.push(`${toolCallCount} ${t(toolCallCount === 1 ? "chat.toolCall" : "chat.toolCalls")}`);

  return (
    <div style={{ marginBottom: 14 }}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => transcriptViewState.toggleExpanded(sessionId, anchorEntryId, PROCESS_DETAILS_PART, defaultExpanded)}
        className="process-details-toggle"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "auto",
          minHeight: 24,
          padding: "2px 0",
          border: "none",
          background: "transparent",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
        }}
        title={expanded ? t("chat.collapseProcess") : t("chat.expandProcess")}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
          <polyline points="4 2.5 7.5 6 4 9.5" />
        </svg>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {parts.join(" · ")}
        </span>
      </button>
      {expanded && (
        <div style={{ marginTop: 8 }}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * 条目渲染要用的一切，流式消息本身除外。
 *
 * 这个对象只在会话、消息或设置变化时重建；流式数据块到达时它保持同一引用，
 * 已挂载条目的行组件因此整块跳过重绘，只有末尾的合成项跟着消息走。
 */
interface TranscriptRowContext {
  messages: AgentMessage[];
  entryIds: readonly string[];
  toolResults: Map<string, ToolResultMessage>;
  modelNames: Record<string, string>;
  cwd?: string;
  /** 用于按会话分桶展开状态。 */
  sessionId?: string;
  /**
   * 流式合成项本轮提问锚点的键：流式气泡与流结束后定稿的那一轮共用同一个桶，
   * 展开状态不会随工具调用变化、也不会在流结束时丢失。
   */
  liveTailAnchorEntryId: string;
  sessionBusy: boolean;
  isNew: boolean;
  forkingEntryId: string | null;
  isStreaming: boolean;
  onOpenFile?: (filePath: string) => void;
  onFork: (entryId: string) => void;
  onNavigate: (entryId: string) => void;
  onEditContent: (message: UserMessage) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

interface RowMessageOptions {
  keyPrefix?: string;
  messageOverride?: AgentMessage;
  showTimestamp?: boolean;
  writtenFiles?: WrittenFile[];
  turnAnchorEntryId?: string;
}

function previousTimestampOf(messages: AgentMessage[], idx: number): number | undefined {
  if (idx <= 0) return undefined;
  const previous = messages[idx - 1];
  return previous && "timestamp" in previous && typeof previous.timestamp === "number"
    ? previous.timestamp
    : undefined;
}

// 视图状态的锚点：一轮里所有部件都挂在提问那条消息的 entryId 上，
// 这样过程组与工具块的展开状态不随分组结果变化；独立渲染的消息退化为自身 entryId。
function renderRowMessage(row: TranscriptRowContext, idx: number, options: RowMessageOptions = {}): ReactNode {
  const msg = options.messageOverride ?? row.messages[idx];
  const prevAssistantEntryId =
    msg.role === "user" && idx > 0 && row.messages[idx - 1].role === "assistant"
      ? row.entryIds[idx - 1]
      : undefined;
  const keyPrefix = options.keyPrefix ?? "message";
  let showTimestamp = false;
  if (msg.role === "assistant") {
    showTimestamp = true;
    for (let j = idx + 1; j < row.messages.length; j++) {
      const r = row.messages[j].role;
      if (r === "user") break;
      if (r === "assistant") { showTimestamp = false; break; }
    }
    // Hide on the currently-streaming tail (the streaming bubble owns the live timestamp)
    if (showTimestamp && row.isStreaming && idx === row.messages.length - 1) {
      showTimestamp = false;
    }
  }
  if (options.showTimestamp !== undefined) showTimestamp = options.showTimestamp;
  return (
    <MessageView
      key={`${keyPrefix}-view-${idx}`}
      message={msg}
      toolResults={row.toolResults}
      modelNames={row.modelNames}
      cwd={row.cwd}
      onOpenFile={row.onOpenFile}
      entryId={row.entryIds[idx]}
      onFork={row.sessionBusy || row.isNew || (idx === 0 && msg.role === "user") ? undefined : row.onFork}
      forking={row.forkingEntryId === row.entryIds[idx]}
      onNavigate={row.sessionBusy ? undefined : row.onNavigate}
      prevAssistantEntryId={row.sessionBusy ? undefined : prevAssistantEntryId}
      onEditContent={row.onEditContent}
      showTimestamp={showTimestamp}
      prevTimestamp={previousTimestampOf(row.messages, idx)}
      sessionId={row.sessionId}
      turnAnchorEntryId={options.turnAnchorEntryId ?? row.entryIds[idx]}
      writtenFiles={options.writtenFiles}
    />
  );
}

// 一个列表项就是一轮：提问、过程组、正式回答都挂在这一个项里。
function renderTranscriptItem(row: TranscriptRowContext, item: TranscriptListItem): ReactNode {
  if (isTranscriptLiveTailItem(item)) {
    // 流式消息是边到边补全的 Partial，MessageView 按 AgentMessage 的字段逐个读取。
    const streamingMessage = item.message as AgentMessage;
    return (
      <MessageView
        message={streamingMessage}
        isStreaming
        modelNames={row.modelNames}
        cwd={row.cwd}
        onOpenFile={row.onOpenFile}
        sessionId={row.sessionId}
        turnAnchorEntryId={row.liveTailAnchorEntryId}
      />
    );
  }

  if (item.isStandalone) {
    return item.messageIndices.map((messageIndex) => renderRowMessage(row, messageIndex, { turnAnchorEntryId: item.key }));
  }

  const turnAnchorEntryId = item.key;
  return (
    <>
      {renderRowMessage(row, item.anchorIndex, { turnAnchorEntryId })}
      {item.processMessageCount > 0 && (
        <div key={`process-group-${item.anchorIndex}-${item.finalAssistantIndex}`}>
          <ProcessDetailsGroup
            messageCount={item.processMessageCount}
            // 含 provider 错误的一组默认展开：折叠起来只剩一个计数，轮中部的错误横幅
            // 就被藏掉了。只有最新一轮这么做——历史轮曾出错后重试成功的不再撑开，
            // 首屏挂载量不随错误轮数增长。
            defaultExpanded={!item.finalAnswerMessage || (item.hasProcessError && item.isLastTurn)}
            sessionId={row.sessionId}
            anchorEntryId={turnAnchorEntryId}
            t={row.t}
            toolCallCount={item.toolCallCount}
          >
            {item.visibleProcessIndices.map((processIdx) => renderRowMessage(row, processIdx, { keyPrefix: "process", turnAnchorEntryId }))}
            {item.finalProcessMessage && renderRowMessage(row, item.finalAssistantIndex, { keyPrefix: "process-final", messageOverride: item.finalProcessMessage, showTimestamp: false, turnAnchorEntryId })}
          </ProcessDetailsGroup>
        </div>
      )}
      {item.finalAnswerMessage
        && renderRowMessage(row, item.finalAssistantIndex, { messageOverride: item.finalAnswerMessage, writtenFiles: item.writtenFiles, turnAnchorEntryId })}
      {item.tailIndices.map((messageIndex) => renderRowMessage(row, messageIndex, { turnAnchorEntryId }))}
    </>
  );
}

/**
 * 列表的一行。条目对象在流式期间保持原引用，上下文同理，所以只有末尾的合成项
 * 会随数据块重绘。
 */
const TranscriptRow = memo(function TranscriptRow({ item, row }: { item: TranscriptListItem; row: TranscriptRowContext }) {
  return <div style={TRANSCRIPT_ROW_STYLE}>{renderTranscriptItem(row, item)}</div>;
});

export function ChatWindow({ session, newSessionCwd, onAgentEnd, onAttentionNeeded, onSessionCreated, onSessionForked, modelsRefreshKey, chatInputRef, onBranchDataChange, onSessionStatsChange, onSessionStatsPanelOpen, onContextUsageChange, onSubagentsChange, onOpenFile, soundEnabled = true, onSoundToggle, playDoneSound = () => {}, unlockAudio }: Props) {
  const { t } = useI18n();

  // Wrap onAgentEnd to play the completion sound. This is more reliable than
  // wrapping handleAgentEventRef because useAgentSession overwrites that ref
  // on every render (it syncs the latest callback), which would blow away an
  // externally-installed wrapper after the first re-render.
  const playDoneSoundRef = useRef(playDoneSound);
  playDoneSoundRef.current = playDoneSound;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  const soundedExtensionDialogIdRef = useRef<string | null>(null);
  const wrappedOnAgentEnd = useCallback((sessionId?: string) => {
    if (soundEnabledRef.current) {
      playDoneSoundRef.current();
    }
    onAgentEnd?.(sessionId);
  }, [onAgentEnd]);

  // 稳定化 onEditContent 引用，配合 React.memo 防止历史消息重渲染
  const handleEditContent = useCallback((message: UserMessage) => {
    chatInputRef?.current?.replaceMessage(message);
  }, [chatInputRef]);

  // 视图跟随交给列表：hook 只决定什么时候该回到底部，定位由列表执行。
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const scrollTranscriptToEnd = useCallback((behavior: ScrollBehavior) => {
    const list = virtuosoRef.current;
    if (!list) return;
    // 列表只认 "auto" 与 "smooth"；"auto" 就是无动画的直接定位。
    const resolved = behavior === "smooth" ? "smooth" : "auto";
    list.scrollToIndex({ index: "LAST", align: "end", behavior: resolved });
    // 条目的「对齐到末端」只把最后一条数据项的底边对上视口底，页脚插槽（阶段提示、
    // 待执行命令预览）在它之后。定位那一刻页脚可能还没提交、也可能还没量到高度，
    // 所以等这一帧的定位与页脚都落到 DOM 上，再让列表滚到真正的底部。
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior: resolved });
    });
  }, []);

  const {
    loading, error, messages, entryIds, streamState,
    agentRunning, bashRunning, pendingBash, modelNames, modelList, modelError, modelScopeWarnings, modelThinkingLevels, modelThinkingLevelMaps, modelRoles, toolPreset, thinkingLevel,
    effectiveThinkingLevel,
    retryInfo, contextUsage, forkingEntryId,
    isCompacting, compactError, compactResult, displayModel: displayModelValue, modelSwitching, sessionStats,
    rewindOpen, closeRewindPanel, handleRewind,
    slashCommands, slashCommandsLoading, queuedMessages, subagents,
    notices, extensionDialog, extensionCustomUi, extensionStatuses, extensionWidgets, respondToExtensionUi, sendExtensionCustomInput,
    isAutoModelSelection,
    agentPhase,
    isNew,
    autoFollowPaused, resumeAutoFollow, pauseAutoFollow, holdFollowObservation, releaseFollowObservation,
    contextFollowTicket,
    goalStatus,
    sessionIdRef, scrollContainerRef,
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange, handleRoleModelChange,
    handleCompact, handleSteer, handleFollowUp, handlePromptWithStreamingBehavior, handleAbortCompaction,
    handleRecallQueue,
    handleBuiltinSlashCommand,
    handleToolPresetChange, handleThinkingLevelChange, loadSlashCommands,
  } = useAgentSession({
    session, newSessionCwd, onAgentEnd: wrappedOnAgentEnd, onAttentionNeeded, onSessionCreated, onSessionForked,
    modelsRefreshKey, chatInputRef, onBranchDataChange, onSessionStatsPanelOpen,
    scrollTranscriptToEnd,
    t,
  });
  const sessionBusy = agentRunning || bashRunning;

  // 首屏落在真正的底部：列表的初始定位只对齐到最后一轮，页脚插槽在它之后。
  const initialBottomLandedRef = useRef(false);
  useEffect(() => {
    if (loading || error || initialBottomLandedRef.current) return;
    initialBottomLandedRef.current = true;
    scrollTranscriptToEnd("auto");
  }, [loading, error, scrollTranscriptToEnd]);
  const rewindEntries = useMemo(
    () => buildRewindEntries(messages, entryIds),
    [messages, entryIds],
  );
  // The picker hands focus back to the composer both when it is dismissed and
  // once a rewind lands, so the restored draft is ready to edit.
  const closeRewind = useCallback(() => {
    closeRewindPanel();
    chatInputRef?.current?.focus();
  }, [closeRewindPanel, chatInputRef]);
  const selectRewindEntry = useCallback(async (entryId: string) => {
    // A failed busy check leaves the picker open; moving focus then would send
    // typing into the composer hidden behind it.
    if (await handleRewind(entryId)) chatInputRef?.current?.focus();
  }, [handleRewind, chatInputRef]);
  // omp's render-affecting settings (hideThinkingBlock). Synced here once for
  // the whole transcript; MessageView reads the shared store directly.
  const { hideThinkingBlock } = useSyncedDisplaySettings(newSessionCwd ?? session?.cwd ?? null);
  const displayOptions = useMemo<DisplayOptions>(() => ({ hideThinking: hideThinkingBlock }), [hideThinkingBlock]);

  useEffect(() => {
    if (!extensionDialog || soundedExtensionDialogIdRef.current === extensionDialog.id) return;
    soundedExtensionDialogIdRef.current = extensionDialog.id;
    playDoneSoundRef.current();
  }, [extensionDialog]);

  // Register the abort handler for the global Esc shortcut
  useEffect(() => {
    registerAbortHandler(sessionBusy ? handleAbort : null);
  }, [sessionBusy, handleAbort]);

  // Push session stats up to AppShell for the top bar.
  // Compare scalar fields to avoid loops from new object identity each render.
  const statsKey = sessionStats
    ? [
      sessionStats.sessionId,
      sessionStats.sessionFile ?? "",
      sessionStats.sessionName ?? "",
      sessionStats.userMessages,
      sessionStats.assistantMessages,
      sessionStats.toolCalls,
      sessionStats.toolResults,
      sessionStats.totalMessages,
      sessionStats.tokens.input,
      sessionStats.tokens.output,
      sessionStats.tokens.cacheRead,
      sessionStats.tokens.cacheWrite,
      sessionStats.tokens.total,
      sessionStats.cost ?? 0,
      sessionStats.totalActiveMs ?? 0,
    ].join("|")
    : null;
  const sessionStatsRef = useRef(sessionStats);
  sessionStatsRef.current = sessionStats;
  useEffect(() => {
    onSessionStatsChange?.(sessionStatsRef.current);
  }, [statsKey, onSessionStatsChange]);
  useEffect(() => () => { onSessionStatsChange?.(null); }, [onSessionStatsChange]);

  // Push context usage up to AppShell as well.
  const ctxKey = contextUsage
    ? `${contextUsage.percent ?? "null"}|${contextUsage.contextWindow}|${contextUsage.tokens ?? "null"}`
    : null;
  const contextUsageRef = useRef(contextUsage);
  contextUsageRef.current = contextUsage;
  useEffect(() => {
    onContextUsageChange?.(contextUsageRef.current);
  }, [ctxKey, onContextUsageChange]);
  useEffect(() => () => { onContextUsageChange?.(null); }, [onContextUsageChange]);
  useEffect(() => {
    onSubagentsChange?.(subagents);
  }, [onSubagentsChange, subagents]);
  useEffect(() => () => { onSubagentsChange?.([]); }, [onSubagentsChange]);


  const onDrop = useCallback((files: File[]) => {
    if (sessionBusy) return;
    chatInputRef?.current?.addImages(files);
  }, [sessionBusy, chatInputRef]);

  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);

  // Stable Map identity: `messages` doesn't change during streaming updates
  // (the streaming message lives in streamState), so memoized MessageViews
  // skip re-rendering on every message_update event. An inline `new Map()`
  // here used to defeat MessageView's memo() on each streamed chunk.
  const toolResultsMap = useMemo(() => {
    const map = new Map<string, ToolResultMessage>();
    for (const msg of messages) {
      if (msg.role === "toolResult") {
        map.set((msg as ToolResultMessage).toolCallId, msg as ToolResultMessage);
      }
    }
    return map;
  }, [messages]);
  const inputHistory = useMemo(() => {
    const seen = new Set<string>();
    const history: string[] = [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const text = getUserInputText(messages[i]);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      history.push(text);
      if (history.length >= 50) break;
    }
    return history.reverse();
  }, [messages]);

  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !sessionBusy;
  const messageCwd = session?.cwd ?? newSessionCwd ?? undefined;

  // 分组判定只在这里发生一次；渲染循环按条目顺序输出，不再自己判断轮次。
  const groupedTranscriptItems = useMemo(
    () => buildTranscriptItems(messages, entryIds, {
      displayOptions,
      isStreaming: streamState.isStreaming,
      busy: sessionBusy,
      toolResults: toolResultsMap,
      cwd: messageCwd,
    }),
    [messages, entryIds, displayOptions, streamState.isStreaming, sessionBusy, toolResultsMap, messageCwd],
  );

  // 流式消息是列表的最后一项：它跟着数据块更新，前面的条目保持原对象。
  // 数据表与键表都从 hasTranscriptLiveTail 这一条判据推出合成项在不在：
  // agent_start 到首个数据块之间流式已开始而消息还是空的，两表必须同样不加。
  const streamingTranscriptMessage = streamState.isStreaming ? streamState.streamingMessage : null;
  const transcriptItems = useMemo(
    () => withTranscriptLiveTail(groupedTranscriptItems, streamingTranscriptMessage),
    [groupedTranscriptItems, streamingTranscriptMessage],
  );
  const transcriptLiveTailKey = hasTranscriptLiveTail(streamingTranscriptMessage)
    ? TRANSCRIPT_LIVE_TAIL_KEY
    : null;

  // 键与首屏定位只由分组结果与合成项的有无决定：流式数据块因此不重建键数组，
  // 列表每块拿到的 itemKeys 与 computeItemKey 都是同一份引用。
  const virtualTranscript = useMemo(
    () => buildVirtualTranscriptModel(groupedTranscriptItems, transcriptLiveTailKey),
    [groupedTranscriptItems, transcriptLiveTailKey],
  );

  // 流式合成项不属于分组，锚点取当前最后一轮的键：流结束后定稿的正是这一轮，
  // 展开状态因此落在同一个桶里。还没有任何一轮时退回合成项自己的键。
  const liveTailAnchorEntryId = groupedTranscriptItems[groupedTranscriptItems.length - 1]?.key
    ?? TRANSCRIPT_LIVE_TAIL_KEY;

  // 跳转条与列表共用同一份分组结果，只为锚点轮取提问原文，不重新扫描消息；
  // 流式合成项不是一轮，圆点数只随正式轮次变化。用户提问只有图片或附件时没有
  // 文本，仍然要占一个圆点：缺了它圆点数就少于提问数，高亮也会错位到相邻轮。
  const railDots = useMemo(
    () => buildTranscriptRailDots(groupedTranscriptItems, (item) => {
      const anchor = messages[item.anchorIndex];
      if (!anchor) return null;
      const text = getUserInputText(anchor);
      if (text !== null) return text;
      return anchor.role === "user" ? t("chat.promptWithoutText") : null;
    }),
    [groupedTranscriptItems, messages, t],
  );

  const transcriptListRef = useRef<HTMLDivElement | null>(null);
  const railRenderedItemsRef = useRef<RailRenderedItem[]>([]);
  const railScrollCleanupRef = useRef<(() => void) | null>(null);
  const railVisibleRef = useRef(false);
  const [topItemIndex, setTopItemIndex] = useState<number | null>(null);
  const [railAtBottom, setRailAtBottom] = useState(false);

  // 顶部可见条目以列表报告的已渲染条目为准：偏移是列表的测量值，这里只补一个
  // 滚动容器与列表容器的矩形差，不按平均高度反推。跳转条在单轮、移动档、窄转写区
  // 下不显示，这时不读尺寸也不写状态，滚动帧里因此没有多余的重渲染。
  const syncRailTopItem = useCallback(() => {
    if (!railVisibleRef.current) return;
    const scroller = scrollContainerRef.current;
    const list = transcriptListRef.current;
    if (!scroller || !list) return;
    const visibleTop = scroller.getBoundingClientRect().top - list.getBoundingClientRect().top;
    const next = railTopVisibleItemIndex(railRenderedItemsRef.current, visibleTop);
    setTopItemIndex((current) => (current === next ? current : next));
    // 最后一段比视口短时，贴底也会让顶部可见条目停在上一轮：高亮另按贴底判一次，
    // 口径与跟随、「回到底部」按钮相同。
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
      <= FOLLOW_BOTTOM_THRESHOLD_PX;
    setRailAtBottom((current) => (current === atBottom ? current : atBottom));
  }, [scrollContainerRef]);

  // 测量合并成一帧一次，滚动与列表报告共用这一个调度：流式期间每个数据块都会报告
  // 一次已渲染条目，在报告里直接测量等于每个块都强制布局两次。
  const railMeasureFrameRef = useRef(0);
  const scheduleRailMeasure = useCallback(() => {
    if (railMeasureFrameRef.current !== 0) return;
    railMeasureFrameRef.current = requestAnimationFrame(() => {
      railMeasureFrameRef.current = 0;
      syncRailTopItem();
    });
  }, [syncRailTopItem]);
  useEffect(() => () => {
    if (railMeasureFrameRef.current !== 0) cancelAnimationFrame(railMeasureFrameRef.current);
  }, []);

  // 是否可见由跳转条自己量：移动档与窄转写区都由 CSS 收起，这里不重复判定断点。
  const handleRailVisibilityChange = useCallback((visible: boolean) => {
    railVisibleRef.current = visible;
    if (visible) syncRailTopItem();
  }, [syncRailTopItem]);

  const handleTranscriptItemsRendered = useCallback((items: ListItem<TranscriptListItem>[]) => {
    // 只登记，不在这里测量。
    railRenderedItemsRef.current = items.map(({ index, offset, size }) => ({ index, offset, size }));
    scheduleRailMeasure();
  }, [scheduleRailMeasure]);

  // 滚动元素由列表提供，句柄交回现有的 scrollContainerRef，
  // 自动跟随、上滚判定与「回到底部」按钮继续挂在同一个滚动元素上；
  // 跳转条的当前轮跟着同一个滚动元素的每一帧更新。
  const handleTranscriptScrollerRef = useCallback((element: HTMLElement | Window | null) => {
    scrollContainerRef.current = element instanceof HTMLDivElement ? element : null;
    railScrollCleanupRef.current?.();
    railScrollCleanupRef.current = null;
    if (!(element instanceof HTMLDivElement)) return;
    element.addEventListener("scroll", scheduleRailMeasure, { passive: true });
    railScrollCleanupRef.current = () => element.removeEventListener("scroll", scheduleRailMeasure);
    syncRailTopItem();
  }, [scrollContainerRef, scheduleRailMeasure, syncRailTopItem]);

  const railCurrentIndex = useMemo(
    () => (topItemIndex === null ? -1 : railCurrentDotIndex(railDots, topItemIndex, railAtBottom)),
    [railDots, topItemIndex, railAtBottom],
  );

  // 跳转只把条目下标交给列表，目标位置由列表自己算。
  const railJumpRef = useRef<RailJumpState>(RAIL_JUMP_IDLE);
  const railJumpTimerRef = useRef<number | null>(null);
  const settleRailJumpNowRef = useRef<() => void>(() => {});

  const clearRailJumpTimer = useCallback(() => {
    if (railJumpTimerRef.current === null) return;
    window.clearTimeout(railJumpTimerRef.current);
    railJumpTimerRef.current = null;
  }, []);

  // 目标附近的行第一次被量出来之前，列表只能按估计高度落点。收尾时再调一次定位
  // 接口，让它按实测高度重新对齐；目标位置依旧由列表算，这里不碰像素。
  const settleRailJumpNow = useCallback(() => {
    clearRailJumpTimer();
    const settled = settleRailJump(railJumpRef.current);
    railJumpRef.current = settled.state;
    if (settled.realign === null) {
      // 落点停下：松开一次性抑制器，之后的位置重新参与跟随判定。
      releaseFollowObservation();
      return;
    }
    virtuosoRef.current?.scrollToIndex({ index: settled.realign, align: "start" });
    // 重定位同样是一次程序化落点，抑制器继续合着：由这次滚动的停止回调松开，
    // 等不到回调时由兜底定时器松开。
    railJumpTimerRef.current = window.setTimeout(() => settleRailJumpNowRef.current(), RAIL_JUMP_SETTLE_MS);
  }, [clearRailJumpTimer, releaseFollowObservation]);
  settleRailJumpNowRef.current = settleRailJumpNow;

  // 转写被整段替换（切分支/切叶）时，挂在旧列表条目下标上的跳转就没意义了：新列表
  // 的下标是另一串条目，按旧目标再对齐一次会把刚回到底部的视图拽回旧轮次。载入一次
  // 就丢掉待清算目标并松开抑制器，回底交给 hook 在提交后自己发起。
  useEffect(() => {
    if (contextFollowTicket === 0) return;
    railJumpRef.current = RAIL_JUMP_IDLE;
    clearRailJumpTimer();
    releaseFollowObservation();
  }, [contextFollowTicket, clearRailJumpTimer, releaseFollowObservation]);

  const handleRailJump = useCallback((itemIndex: number) => {
    // 跳转是一次有意的位置改变：停掉跟随，视图不再被末尾输出拽走。
    pauseAutoFollow();
    // 落点由列表带出来，这串滚动说明不了用户意图：合上抑制器，别让落点贴底时
    // 又把刚停掉的跟随打开。
    holdFollowObservation();
    railJumpRef.current = { pending: itemIndex };
    virtuosoRef.current?.scrollToIndex({ index: itemIndex, align: "start" });
    clearRailJumpTimer();
    // 兜底：点击已经在顶部的圆点不会产生滚动，等不到列表的停止回调，也要在短时间
    // 后清掉目标并松开抑制器，否则之后任意一次滚动停下都会把视图拽回这一轮。
    railJumpTimerRef.current = window.setTimeout(settleRailJumpNow, RAIL_JUMP_SETTLE_MS);
  }, [clearRailJumpTimer, holdFollowObservation, pauseAutoFollow, settleRailJumpNow]);

  // 「回到底部」按钮的位置来源只有一个：列表停稳后的确认帧实测。跟随暂停时按钮本来
  // 就该出现，跟随开着而列表没跟上时也留一个恢复入口。位置要等列表停稳再确认一帧才
  // 落成状态：跟随途中、首屏与 load 回底的程序化滚动都会经过不在底部的区间，列表自己
  // 的 atBottomStateChange 在途中也报 false，按它落状态就会把按钮钉出来。确认帧直接
  // 读列表自己的滚动位置，判定口径与列表的 atBottomThreshold 是同一个常量；没有滚动
  // 元素时留着上一次的结论，不凭空翻转。
  const [transcriptAtBottom, setTranscriptAtBottom] = useState(true);
  const transcriptAtBottomFrameRef = useRef(0);
  const measureTranscriptAtBottom = useCallback(() => {
    const scroller = scrollContainerRef.current;
    if (!scroller) return null;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= FOLLOW_BOTTOM_THRESHOLD_PX;
  }, [scrollContainerRef]);

  // 列表停稳：按实测高度收尾一次跳转，并松开落点抑制器。两条时机共用同一份目标，
  // 先到的那条清算。
  const handleTranscriptScrollingChange = useCallback((scrolling: boolean) => {
    if (scrolling) return;
    settleRailJumpNow();
    if (transcriptAtBottomFrameRef.current !== 0) return;
    transcriptAtBottomFrameRef.current = requestAnimationFrame(() => {
      transcriptAtBottomFrameRef.current = 0;
      const atBottom = measureTranscriptAtBottom();
      if (atBottom !== null) setTranscriptAtBottom(atBottom);
    });
  }, [measureTranscriptAtBottom, settleRailJumpNow]);
  // 卸载时取消还没落地的确认帧。
  useEffect(() => () => {
    if (transcriptAtBottomFrameRef.current !== 0) cancelAnimationFrame(transcriptAtBottomFrameRef.current);
  }, []);

  useEffect(() => () => {
    railScrollCleanupRef.current?.();
    clearRailJumpTimer();
  }, [clearRailJumpTimer]);

  const computeTranscriptItemKey = useCallback(
    (index: number) => virtualTranscript.itemKeys[index],
    [virtualTranscript],
  );

  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const chatInputElement = (
    <ChatInput
      ref={chatInputRef}
      onSend={handleSend}
      onAbort={handleAbort}
      onSteer={agentRunning ? handleSteer : undefined}
      onFollowUp={agentRunning ? handleFollowUp : undefined}
      onPromptWithStreamingBehavior={agentRunning ? handlePromptWithStreamingBehavior : undefined}
      isStreaming={sessionBusy}
      model={displayModelValue}
      isAutoModelSelection={isAutoModelSelection}
      modelNames={modelNames}
      modelList={modelList}
      modelError={modelError}
      modelScopeWarnings={modelScopeWarnings}
      onModelChange={handleModelChange}
      modelRoles={modelRoles}
      onRoleModelChange={handleRoleModelChange}
      modelSwitching={modelSwitching}
      onCompact={session || isNew ? handleCompact : undefined}
      onAbortCompaction={handleAbortCompaction}
      isCompacting={isCompacting}
      compactError={compactError}
      compactResult={compactResult}
      toolPreset={toolPreset}
      onToolPresetChange={session || isNew ? handleToolPresetChange : undefined}
      thinkingLevel={thinkingLevel}
      effectiveThinkingLevel={effectiveThinkingLevel}
      onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
      availableThinkingLevels={availableThinkingLevels}
      thinkingLevelMap={currentThinkingLevelMap}
      retryInfo={retryInfo}
      queuedMessages={queuedMessages}
      contextUsage={contextUsage}
      inputHistory={inputHistory}
      onRecallQueue={handleRecallQueue}
      slashCommands={slashCommands}
      slashCommandsLoading={slashCommandsLoading}
      onLoadSlashCommands={loadSlashCommands}
      onBuiltinCommand={handleBuiltinSlashCommand}
      soundEnabled={soundEnabled}
      onSoundToggle={onSoundToggle}
      onAudioUnlock={unlockAudio}
      draftKey={session?.id ?? (newSessionCwd ? `new:${newSessionCwd}` : undefined)}
      cwd={session?.cwd ?? newSessionCwd}
    />
  );

  // 两个派生数组也按内容收住：每次渲染新算会让页首插槽每帧换引用，context 一变，
  // 整份条目的 itemContent 就跟着全量重跑。
  const aboveEditorWidgets = useMemo(
    () => extensionWidgets.filter((widget) => widget.placement !== "belowEditor"),
    [extensionWidgets],
  );
  const belowEditorWidgets = useMemo(
    () => extensionWidgets.filter((widget) => widget.placement === "belowEditor"),
    [extensionWidgets],
  );

  // 每行共用同一份上下文；流式数据块不重建它，已挂载条目的行组件因此不重绘。
  const activeSessionId = session?.id ?? sessionIdRef.current ?? undefined;

  // 转写同一时刻只显示一个会话：切走之后上一会话的正文与展开状态不再有用，
  // 在这里丢掉，模块级视图状态不随会话数增长。
  useEffect(() => {
    transcriptViewState.retainSession(activeSessionId);
  }, [activeSessionId]);

  // 换会话就是换一份列表：新列表从末尾挂载，按钮的第二个来源跟着复位，别把上一份
  // 列表的上滚位置留在新会话上。
  useEffect(() => {
    setTranscriptAtBottom(true);
  }, [activeSessionId]);

  const transcriptRowContext = useMemo<TranscriptRowContext>(() => ({
    messages,
    entryIds,
    toolResults: toolResultsMap,
    modelNames,
    cwd: messageCwd,
    sessionId: activeSessionId,
    liveTailAnchorEntryId,
    sessionBusy,
    isNew,
    forkingEntryId,
    isStreaming: streamState.isStreaming,
    onOpenFile,
    onFork: handleFork,
    onNavigate: handleNavigate,
    onEditContent: handleEditContent,
    t,
  }), [
    messages, entryIds, toolResultsMap, modelNames, messageCwd, activeSessionId, liveTailAnchorEntryId, sessionBusy, isNew,
    forkingEntryId, streamState.isStreaming, onOpenFile, handleFork, handleNavigate, handleEditContent, t,
  ]);

  const renderTranscriptRow = useCallback(
    (_index: number, item: TranscriptListItem) => <TranscriptRow item={item} row={transcriptRowContext} />,
    [transcriptRowContext],
  );

  // 列表之外的部件走页首/页尾插槽，仍在同一条滚动流里。列表把 context 当作状态发布：
  // 引用一变，整份条目的 itemContent 都会重跑，所以页首、页尾与承载它们的对象都要按
  // 内容收成稳定引用。流式正文是列表自己的最后一项，页尾只关心它在不在列表里——整份
  // streamState 每个数据块都换引用，不能拿来当依赖。
  const streamingMessageInList = streamState.streamingMessage !== null;
  const transcriptHeader = useMemo(() => (
    <div style={{ ...TRANSCRIPT_ROW_STYLE, paddingTop: 16 }}>
      <ExtensionWidgets widgets={aboveEditorWidgets} />
    </div>
  ), [aboveEditorWidgets]);
  const transcriptFooter = useMemo(() => (
    <div style={TRANSCRIPT_ROW_STYLE}>
      {agentRunning && !streamingMessageInList && agentPhase && (
        <div className="py-2 text-[13px] text-text-muted">
          <span className="animate-[pulse_1.5s_infinite]">{phaseLabel(agentPhase, t)}</span>
        </div>
      )}

      {bashRunning && !pendingBash && (
        <div className="py-2 text-[13px] text-text-muted">
          <span className="animate-[pulse_1.5s_infinite]">{t("chat.runningCommand")}</span>
        </div>
      )}

      {pendingBash && (
        <MessageView
          message={{
            role: "bashExecution",
            command: pendingBash.command,
            output: "",
            excludeFromContext: pendingBash.excludeFromContext,
          } as BashExecutionMessage}
          sessionId={activeSessionId}
        />
      )}
    </div>
  ), [agentRunning, streamingMessageInList, agentPhase, t, bashRunning, pendingBash, activeSessionId]);
  const transcriptSlots = useMemo<TranscriptSlotsContext>(
    () => ({ header: transcriptHeader, footer: transcriptFooter }),
    [transcriptHeader, transcriptFooter],
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">
         {t("chat.loadingSession")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full min-w-0 flex-col overflow-hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && !sessionBusy && (
        <div className="pointer-events-none absolute inset-0 z-50 flex animate-[drop-zone-in_0.15s_ease_both] items-center justify-center bg-[rgba(37,99,235,0.06)] backdrop-blur-[1px]">
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {[0, 0.8, 1.6].map((delay) => (
              <div
                key={delay}
                className="absolute h-[720px] w-[720px] rounded-full border-[1.5px] border-solid border-[rgba(37,99,235,0.5)] animate-[drop-ripple_2.4s_ease-out_infinite_backwards]"
                style={{ transformOrigin: "center", animationDelay: `${delay}s` }}
              />
            ))}
          </div>
          <svg
            width="280" height="280" viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg"
            className="drop-shadow-[0_6px_18px_rgba(37,99,235,0.18)]"
          >
            <rect x="28" y="44" width="84" height="60" rx="8" fill="rgba(37,99,235,0.08)" stroke="rgba(37,99,235,0.50)" strokeWidth="1.8"/>
            <path d="M36 100 L54 72 L68 88 L80 74 L104 100Z" fill="rgba(37,99,235,0.16)" stroke="rgba(37,99,235,0.40)" strokeWidth="1.4" strokeLinejoin="round"/>
            <circle cx="96" cy="58" r="8" fill="rgba(37,99,235,0.22)" stroke="rgba(37,99,235,0.55)" strokeWidth="1.6"/>
            <g stroke="rgba(37,99,235,0.45)" strokeWidth="1.4" strokeLinecap="round">
              <line x1="96" y1="46" x2="96" y2="43"/>
              <line x1="96" y1="70" x2="96" y2="73"/>
              <line x1="84" y1="58" x2="81" y2="58"/>
              <line x1="108" y1="58" x2="111" y2="58"/>
              <line x1="87.5" y1="49.5" x2="85.4" y2="47.4"/>
              <line x1="104.5" y1="66.5" x2="106.6" y2="68.6"/>
              <line x1="104.5" y1="49.5" x2="106.6" y2="47.4"/>
              <line x1="87.5" y1="66.5" x2="85.4" y2="68.6"/>
            </g>
          </svg>
        </div>
      )}

      {extensionDialog && (
        <ExtensionDialog
          request={extensionDialog}
          onRespond={respondToExtensionUi}
        />
      )}

      {extensionCustomUi && (
        <ExtensionCustomPanel
          request={extensionCustomUi}
          onInput={sendExtensionCustomInput}
        />
      )}

      {rewindOpen && (
        <RewindDialog
          entries={rewindEntries}
          onSelect={selectRewindEntry}
          onClose={closeRewind}
        />
      )}

      {isEmptyNew ? (
        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8">
          <div className="w-full" style={{ maxWidth: RAIL_COLUMN_WIDTH_PX }}>
            <div
              className="mb-3"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                marginLeft: 16,
                marginRight: 52,
                fontFamily: "var(--font-mono)",
              }}
            >
              <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                <OmpWordmark />
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  web <span style={{ color: "var(--text)" }}>v{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}</span>
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  omp <span style={{ color: "var(--text)" }}>v{process.env.NEXT_PUBLIC_OMP_VERSION ?? "0.0.0"}</span>
                </span>
              </div>
            </div>
            <NoticeShelf notices={notices} align="right" />
            {chatInputElement}
          </div>
        </div>
      ) : (
      <>
      <div className="chat-transcript-region flex min-w-0 flex-1 overflow-hidden">
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 0,
            right: 0,
            zIndex: 40,
            padding: `0 ${CHAT_COLUMN_PADDING}px`,
            pointerEvents: "none",
          }}
        >
          <div style={{ maxWidth: RAIL_COLUMN_WIDTH_PX, margin: "0 auto" }}>
            <NoticeShelf notices={notices} floating align="right" />
          </div>
        </div>
        {/* 跳转条排在转写之前：Tab 先到导航条，不必穿过整段会话里的链接与按钮。 */}
        {shouldShowTranscriptRail(railDots.length) && (
          <TranscriptRail
            dots={railDots}
            currentDotIndex={railCurrentIndex}
            onJump={handleRailJump}
            onVisibilityChange={handleRailVisibilityChange}
            t={t}
          />
        )}
        <TranscriptListRefContext.Provider value={transcriptListRef}>
          <Virtuoso<TranscriptListItem, TranscriptSlotsContext>
            ref={virtuosoRef}
            data={transcriptItems}
            computeItemKey={computeTranscriptItemKey}
            initialTopMostItemIndex={virtualTranscript.initialTopMostItemIndex}
            context={transcriptSlots}
            components={TRANSCRIPT_SLOTS}
            scrollerRef={handleTranscriptScrollerRef}
            itemsRendered={handleTranscriptItemsRendered}
            isScrolling={handleTranscriptScrollingChange}
            increaseViewportBy={TRANSCRIPT_VIEWPORT_BUFFER}
            followOutput={transcriptFollowOutput(autoFollowPaused)}
            atBottomThreshold={FOLLOW_BOTTOM_THRESHOLD_PX}
            className="chat-session-scroll min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
            itemContent={renderTranscriptRow}
          />
        </TranscriptListRefContext.Provider>
        {(autoFollowPaused || !transcriptAtBottom) && (
          <button
            type="button"
            onClick={resumeAutoFollow}
            aria-label={t("chat.jumpToBottom")}
            title={t("chat.jumpToBottom")}
            style={{
              position: "absolute",
              bottom: 16,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 40,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 999,
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text-muted)",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
              boxShadow: "0 2px 10px rgba(0,0,0,0.28)",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14" />
              <path d="m19 12-7 7-7-7" />
            </svg>
            {t("chat.jumpToBottom")}
          </button>
        )}
      </div>

      <div className="relative">
        <div
          style={{
            padding: `0 ${CHAT_COLUMN_PADDING}px`,
          }}
        >
          <div style={{ maxWidth: RAIL_COLUMN_WIDTH_PX, margin: "0 auto" }}>
            <GoalBar goal={goalStatus} t={t} />
            <ExtensionWidgets widgets={belowEditorWidgets} />
          </div>
        </div>
        {chatInputElement}
        <ExtensionStatusBar statuses={extensionStatuses} />
      </div>
      </>
      )}
    </div>
  );
}

/**
 * Goal mode runs a continuation loop between turns, so the operator needs to
 * see that it is on and how much budget is left without asking for it.
 */
function GoalBar({ goal, t }: { goal: GoalStatusInfo | null; t: (key: string, params?: Record<string, string | number>) => string }) {
  if (!goal) return null;
  const paused = !goal.enabled;
  const budget = goal.tokenBudget !== undefined
    ? t("chat.goalBudgetLeft", { left: formatTokenCount(Math.max(0, goal.tokenBudget - goal.tokensUsed)) })
    : t("chat.goalTokensUsed", { used: formatTokenCount(goal.tokensUsed) });
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 8,
        padding: "5px 10px",
        border: "1px solid var(--border)",
        borderRadius: 7,
        background: "var(--bg-panel)",
        color: "var(--text-muted)",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        opacity: paused ? 0.7 : 1,
      }}
    >
      <span style={{ color: paused ? "var(--text-dim)" : "var(--accent)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0 }}>
        {t("chat.goalLabel")}
      </span>
      <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)" }}>
        {goal.objective}
      </span>
      <span style={{ flexShrink: 0, color: "var(--text-dim)" }}>
        {paused ? t("chat.goalPaused") : goal.status}
      </span>
      <span style={{ flexShrink: 0, color: "var(--text-dim)" }}>{budget}</span>
    </div>
  );
}

function ExtensionWidgets({ widgets }: { widgets: Array<{ key: string; lines: string[] }> }) {
  if (widgets.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
      {widgets.map((widget) => (
        <div
          key={widget.key}
          style={{
            border: "1px solid var(--border)",
            borderRadius: 7,
            background: "var(--bg-panel)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "5px 9px", borderBottom: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
            {widget.key}
          </div>
          <pre style={{ margin: 0, padding: "8px 9px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-mono)" }}>
            {widget.lines.join("\n")}
          </pre>
        </div>
      ))}
    </div>
  );
}

function NoticeShelf({ notices, floating = false, align = "left" }: { notices: NoticeItem[]; floating?: boolean; align?: "left" | "right" }) {
  if (notices.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "right" ? "flex-end" : "stretch",
        marginBottom: floating ? 0 : 10,
      }}
    >
      {notices.map((notice, index) => {
        const color = notice.type === "error"
          ? "#ef4444"
          : notice.type === "warning"
            ? "#d97706"
            : notice.type === "success"
              ? "#10b981"
              : "var(--accent)";
        return (
          <div
            key={notice.id}
            className="notice-shelf-item"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minHeight: 60,
              height: 60,
              maxHeight: 60,
              marginBottom: index === notices.length - 1 ? 0 : 6,
              overflow: "hidden",
              borderRadius: 14,
              border: "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              width: "fit-content",
              maxWidth: "min(100%, 620px)",
              boxShadow: floating
                ? "0 1px 2px rgba(15,23,42,0.05), 0 10px 28px -14px rgba(15,23,42,0.24)"
                : "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.10)",
              fontSize: 18,
              lineHeight: 1.45,
              transformOrigin: "top center",
              animation: notice.exiting
                ? "notice-shelf-out 0.18s ease-in forwards"
                : "notice-shelf-in 0.18s ease-out both",
              padding: "0 12px",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: color,
                flexShrink: 0,
              }}
            />
            <span style={{ padding: "14px 0", minWidth: 0, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {notice.message}
            </span>
          </div>
        );
      })}
    </div>
  );
}

type ExtensionDialogRequest = Extract<
  ExtensionUiRequest,
  { method: "select" | "confirm" | "input" | "editor" | "ask" | "plan_review" }
>;

function ExtensionDialog({
  request,
  onRespond,
}: {
  request: ExtensionDialogRequest;
  onRespond: (request: ExtensionDialogRequest, response: { value: string } | { confirmed: boolean } | { cancelled: true }) => void;
}) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [value, setValue] = useState(request.method === "editor" ? request.prefill ?? "" : "");
  const [selectedOptions, setSelectedOptions] = useState<Record<string, number[]>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [planFeedback, setPlanFeedback] = useState("");

  useEffect(() => {
    setValue(request.method === "editor" ? request.prefill ?? "" : "");
    setPlanFeedback("");
    setCustomAnswers({});
    if (request.method !== "ask") {
      setSelectedOptions({});
      return;
    }
    const recommended: Record<string, number[]> = {};
    for (const question of request.questions) {
      recommended[question.id] = question.recommended !== undefined
        && question.options[question.recommended] !== undefined
        ? [question.recommended]
        : [];
    }
    setSelectedOptions(recommended);
  }, [request]);

  const submitValue = () => {
    if (request.method === "confirm") {
      onRespond(request, { confirmed: true });
    } else {
      onRespond(request, { value });
    }
  };
  if (request.method === "ask") {
    const canSubmit = request.questions.every((question) =>
      (selectedOptions[question.id]?.length ?? 0) > 0
      || (customAnswers[question.id]?.trim().length ?? 0) > 0);
    const toggleOption = (questionId: string, optionIndex: number, multi: boolean) => {
      setSelectedOptions((current) => {
        const selected = current[questionId] ?? [];
        const next = multi
          ? selected.includes(optionIndex)
            ? selected.filter((index) => index !== optionIndex)
            : [...selected, optionIndex]
          : [optionIndex];
        return { ...current, [questionId]: next };
      });
    };
    const submitAnswers = () => {
      if (!canSubmit) return;
      onRespond(request, {
        value: JSON.stringify({
          kind: "submit",
          results: request.questions.map((question) => {
            const customInput = customAnswers[question.id]?.trim();
            return {
              id: question.id,
              question: question.question,
              options: question.options.map((option) => option.label),
              multi: question.multi ?? false,
              selectedOptions: (selectedOptions[question.id] ?? [])
                .map((index) => question.options[index]?.label)
                .filter((option): option is string => option !== undefined),
              ...(customInput ? { customInput } : {}),
            };
          }),
        }),
      });
    };

    return (
      <div
        onKeyDown={(event) => {
          if (event.key === "Escape") onRespond(request, { cancelled: true });
        }}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 90,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: isMobile ? 12 : 16,
          background: "color-mix(in srgb, #000 26%, transparent)",
          backdropFilter: "blur(2px)",
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("chat.agentQuestion")}
          style={{
            display: "flex",
            flexDirection: "column",
            width: "min(720px, 100%)",
            maxHeight: isMobile
              ? "min(100%, calc(var(--app-viewport-height, 100dvh) - 24px))"
              : "min(780px, calc(100dvh - 32px))",
            overflow: "hidden",
            border: "1px solid var(--border)",
            borderRadius: 10,
            background: "var(--bg)",
            boxShadow: "0 24px 80px rgba(0,0,0,0.32)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--border)", flexShrink: isMobile ? 0 : undefined }}>
            <span
              aria-hidden="true"
              style={{
                display: "grid",
                placeItems: "center",
                width: 24,
                height: 24,
                borderRadius: 6,
                background: "color-mix(in srgb, var(--accent) 12%, var(--bg-panel))",
                color: "var(--accent)",
                fontSize: 13,
                fontWeight: 750,
              }}
            >
              ?
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 680 }}>{t("chat.agentQuestion")}</div>
              <div style={{ marginTop: 2, color: "var(--text-dim)", fontSize: 11 }}>{t("chat.agentQuestionHint")}</div>
            </div>
          </div>

          <div style={{ overflowY: "auto", padding: 16, flex: isMobile ? "1 1 auto" : undefined, minHeight: isMobile ? 0 : undefined }}>
            <div style={{ display: "grid", gap: 14 }}>
              {request.questions.map((question, questionIndex) => {
                const selected = selectedOptions[question.id] ?? [];
                return (
                  <section
                    key={question.id}
                    style={{
                      padding: 14,
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      background: "var(--bg-panel)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
                      {question.header && (
                        <span style={{ color: "var(--accent)", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                          {question.header}
                        </span>
                      )}
                      {request.questions.length > 1 && (
                        <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 10, fontVariantNumeric: "tabular-nums" }}>
                          {questionIndex + 1}/{request.questions.length}
                        </span>
                      )}
                    </div>
                    <div style={{ marginBottom: 10, color: "var(--text)", fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>
                      {question.question}
                    </div>
                    <div
                      role={question.multi ? "group" : "radiogroup"}
                      aria-label={question.question}
                      style={{ display: "grid", gap: 7 }}
                    >
                      {question.options.map((option, optionIndex) => {
                        const checked = selected.includes(optionIndex);
                        const recommended = question.recommended === optionIndex;
                        return (
                          <button
                            key={`${question.id}:${optionIndex}`}
                            type="button"
                            role={question.multi ? "checkbox" : "radio"}
                            aria-checked={checked}
                            onClick={() => toggleOption(question.id, optionIndex, question.multi ?? false)}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "18px minmax(0, 1fr) auto",
                              alignItems: "start",
                              gap: 9,
                              width: "100%",
                              minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined,
                              padding: "9px 10px",
                              border: `1px solid ${checked ? "color-mix(in srgb, var(--accent) 55%, var(--border))" : "var(--border)"}`,
                              borderRadius: 7,
                              background: checked ? "color-mix(in srgb, var(--accent) 8%, var(--bg))" : "var(--bg)",
                              color: "var(--text)",
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            <span
                              aria-hidden="true"
                              style={{
                                display: "grid",
                                placeItems: "center",
                                width: 16,
                                height: 16,
                                marginTop: 1,
                                border: `1px solid ${checked ? "var(--accent)" : "var(--text-dim)"}`,
                                borderRadius: question.multi ? 4 : "50%",
                                background: checked ? "var(--accent)" : "transparent",
                                color: "#fff",
                                fontSize: 10,
                                lineHeight: 1,
                              }}
                            >
                              {checked && (question.multi ? (
                                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <polyline points="2 5.2 4.1 7.2 8 2.8" />
                                </svg>
                              ) : (
                                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }} />
                              ))}
                            </span>
                            <span style={{ minWidth: 0 }}>
                              <span style={{ display: "block", fontSize: 12.5, fontWeight: checked ? 650 : 500 }}>{option.label}</span>
                              {option.description && (
                                <span style={{ display: "block", marginTop: 3, color: "var(--text-muted)", fontSize: 11, lineHeight: 1.45 }}>
                                  {option.description}
                                </span>
                              )}
                              {checked && option.preview && (
                                <span style={{ display: "block", marginTop: 8, padding: "7px 8px", borderLeft: "2px solid var(--accent)", background: "var(--bg-subtle)", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                                  {option.preview}
                                </span>
                              )}
                            </span>
                            {recommended && (
                              <span style={{ color: "var(--accent)", fontSize: 9, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                                {t("chat.recommended")}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <input
                      value={customAnswers[question.id] ?? ""}
                      onChange={(event) => setCustomAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submitAnswers();
                      }}
                      placeholder={t("chat.customAnswer")}
                      aria-label={t("chat.customAnswer")}
                      style={{
                        width: "100%",
                        height: isMobile ? MOBILE_HIT_TARGET_PX : 34,
                        marginTop: 9,
                        padding: "0 10px",
                        border: "1px solid var(--border)",
                        borderRadius: 7,
                        outline: "none",
                        background: "var(--bg)",
                        color: "var(--text)",
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                      }}
                    />
                  </section>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, padding: "10px 16px", borderTop: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: isMobile ? 0 : undefined }}>
            <button
              type="button"
              onClick={() => onRespond(request, { cancelled: true })}
              style={{ padding: "7px 10px", minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined, minWidth: isMobile ? MOBILE_HIT_TARGET_PX : undefined, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text-muted)", cursor: "pointer" }}
            >
              {t("chat.cancel")}
            </button>
            <button
              type="button"
              onClick={() => onRespond(request, { value: JSON.stringify({ kind: "chat" }) })}
              style={{ padding: "7px 10px", minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined, minWidth: isMobile ? MOBILE_HIT_TARGET_PX : undefined, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}
            >
              {t("chat.chatAboutThis")}
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={submitAnswers}
              style={{
                padding: "7px 12px",
                minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined,
                minWidth: isMobile ? MOBILE_HIT_TARGET_PX : undefined,
                border: "1px solid var(--accent)",
                borderRadius: 6,
                background: "var(--accent)",
                color: "#fff",
                cursor: canSubmit ? "pointer" : "not-allowed",
                opacity: canSubmit ? 1 : 0.45,
                fontWeight: 650,
              }}
            >
              {t("chat.submitAnswer")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (request.method === "plan_review") {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 90,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: isMobile ? 12 : 16,
          background: "color-mix(in srgb, #000 30%, transparent)",
          backdropFilter: "blur(2px)",
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`plan-review-${request.id}`}
          style={{
            display: "flex",
            flexDirection: "column",
            width: "min(820px, 100%)",
            height: isMobile
              ? "min(820px, calc(var(--app-viewport-height, 100dvh) - 24px))"
              : "min(820px, calc(100dvh - 32px))",
            maxHeight: isMobile ? "100%" : undefined,
            overflow: "hidden",
            border: "1px solid var(--border)",
            borderRadius: 10,
            background: "var(--bg)",
            boxShadow: "0 24px 80px rgba(0,0,0,0.34)",
          }}
        >
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", flexShrink: isMobile ? 0 : undefined }}>
            <div style={{ color: "var(--accent)", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {t("chat.planApproval")}
            </div>
            <div id={`plan-review-${request.id}`} style={{ marginTop: 4, color: "var(--text)", fontSize: 15, fontWeight: 680 }}>
              {request.title}
            </div>
            <div style={{ marginTop: 5, color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 10, overflowWrap: "anywhere" }}>
              {request.planFilePath}
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 20px" }}>
            <MarkdownBody>{request.planContent}</MarkdownBody>
          </div>

          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: isMobile ? 0 : undefined }}>
            <textarea
              value={planFeedback}
              onChange={(event) => setPlanFeedback(event.target.value)}
              placeholder={t("chat.planFeedback")}
              aria-label={t("chat.planFeedback")}
              style={{
                width: "100%",
                minHeight: 64,
                maxHeight: 150,
                padding: "9px 10px",
                border: "1px solid var(--border)",
                borderRadius: 7,
                outline: "none",
                resize: "vertical",
                background: "var(--bg)",
                color: "var(--text)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                lineHeight: 1.5,
              }}
            />
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, marginTop: 9 }}>
              <button
                type="button"
                onClick={() => onRespond(request, {
                  value: JSON.stringify({ action: "refine", feedback: planFeedback.trim() }),
                })}
                style={{ padding: "7px 11px", minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined, minWidth: isMobile ? MOBILE_HIT_TARGET_PX : undefined, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", cursor: "pointer" }}
              >
                {t("chat.refinePlan")}
              </button>
              <button
                type="button"
                onClick={() => onRespond(request, { value: JSON.stringify({ action: "approve" }) })}
                style={{ padding: "7px 12px", minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined, minWidth: isMobile ? MOBILE_HIT_TARGET_PX : undefined, border: "1px solid var(--accent)", borderRadius: 6, background: "var(--accent)", color: "#fff", cursor: "pointer", fontWeight: 650 }}
              >
                {t("chat.approvePlan")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: isMobile ? 12 : 20,
        background: "rgba(0,0,0,0.18)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: "min(560px, 100%)",
          maxHeight: isMobile ? "min(100%, calc(var(--app-viewport-height, 100dvh) - 24px))" : undefined,
          display: isMobile ? "flex" : undefined,
          flexDirection: isMobile ? "column" : undefined,
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", flexShrink: isMobile ? 0 : undefined }}>
          <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 650 }}>{request.title}</div>
          <div style={{ marginTop: 3, color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}>{t("chat.extensionRequest")}</div>
        </div>

        <div style={{ padding: 14, flex: isMobile ? "1 1 auto" : undefined, minHeight: isMobile ? 0 : undefined, overflowY: isMobile ? "auto" : undefined }}>
          {request.method === "confirm" && (
            <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{request.message}</div>
          )}
          {request.method === "select" && (
            <div style={{ display: "grid", gap: 8 }}>
              {request.options.map((option) => (
                <button
                  key={option}
                  onClick={() => onRespond(request, { value: option })}
                  style={{
                    width: "100%",
                    minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined,
                    padding: "9px 10px",
                    borderRadius: 7,
                    border: "1px solid var(--border)",
                    background: "var(--bg-panel)",
                    color: "var(--text)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 13,
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          {request.method === "input" && (
            <input
              autoFocus
              value={value}
              placeholder={request.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitValue();
                if (e.key === "Escape") onRespond(request, { cancelled: true });
              }}
              style={{
                width: "100%",
                padding: "9px 10px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                outline: "none",
                fontSize: 13,
              }}
            />
          )}
          {request.method === "editor" && (
            <textarea
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onRespond(request, { cancelled: true });
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submitValue();
              }}
              style={{
                width: "100%",
                minHeight: 220,
                padding: 10,
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                outline: "none",
                resize: "vertical",
                fontSize: 13,
                lineHeight: 1.55,
                fontFamily: "var(--font-mono)",
              }}
            />
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: isMobile ? 0 : undefined }}>
          <button
            onClick={() => onRespond(request, { cancelled: true })}
            style={{
              padding: "6px 10px",
              minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined,
              minWidth: isMobile ? MOBILE_HIT_TARGET_PX : undefined,
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
             {t("chat.cancel")}
          </button>
          {request.method === "confirm" ? (
            <button
              onClick={submitValue}
              style={{
                padding: "6px 10px",
                minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined,
                minWidth: isMobile ? MOBILE_HIT_TARGET_PX : undefined,
                borderRadius: 6,
                border: "1px solid var(--accent)",
                background: "var(--accent)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
               {t("chat.confirm")}
            </button>
          ) : request.method !== "select" ? (
            <button
              onClick={submitValue}
              style={{
                padding: "6px 10px",
                minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined,
                minWidth: isMobile ? MOBILE_HIT_TARGET_PX : undefined,
                borderRadius: 6,
                border: "1px solid var(--accent)",
                background: "var(--accent)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
               {t("chat.submit")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type ExtensionCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;

function renderAnsiLine(line: string, keyPrefix: string): ReactNode[] {
  return parseAnsiLine(line).map((segment, index) => (
    Object.keys(segment.style).length > 0
      ? <span key={`${keyPrefix}-${index}`} style={segment.style}>{segment.text}</span>
      : segment.text
  ));
}

function ExtensionCustomPanel({
  request,
  onInput,
}: {
  request: ExtensionCustomRequest;
  onInput: (request: ExtensionCustomRequest, data: string) => void;
}) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const displayLines = normalizeCustomPanelLines(request.lines);

  useEffect(() => {
    inputRef.current?.focus();
  }, [request.id]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 95,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: isMobile ? 12 : 20,
        background: "rgba(0,0,0,0.18)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) inputRef.current?.focus();
        }}
        style={{
          position: "relative",
          width: "min(920px, 100%)",
          maxHeight: isMobile
            ? "min(760px, 100%, calc(var(--app-viewport-height, 100dvh) - 24px))"
            : "min(760px, calc(100vh - 40px))",
          display: isMobile ? "flex" : undefined,
          flexDirection: isMobile ? "column" : undefined,
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
          overflow: "hidden",
          outline: "none",
        }}
      >
        <textarea
          ref={inputRef}
           aria-label={t("chat.extensionInput")}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(event) => {
            if (composingRef.current || event.nativeEvent.isComposing) return;
            const data = toTerminalKeyData(event);
            if (!data) return;
            event.preventDefault();
            event.stopPropagation();
            onInput(request, data);
          }}
          onInput={(event) => {
            if (composingRef.current || event.nativeEvent.isComposing) return;
            const text = event.currentTarget.value;
            event.currentTarget.value = "";
            if (text) onInput(request, text);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            const input = event.currentTarget;
            queueMicrotask(() => {
              const text = input.value;
              input.value = "";
              if (text) onInput(request, text);
            });
          }}
          onPaste={(event) => {
            event.preventDefault();
            const text = event.clipboardData.getData("text");
            if (text) onInput(request, asBracketedPaste(text));
          }}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            border: 0,
            opacity: 0,
            pointerEvents: "none",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", borderBottom: "1px solid var(--border)", flexShrink: isMobile ? 0 : undefined }}>
           <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 650 }}>{t("chat.extensionPanel")}</div>
          <button
            onClick={() => onInput(request, "\x03")}
            style={{
              padding: "5px 9px",
              minHeight: isMobile ? MOBILE_HIT_TARGET_PX : undefined,
              minWidth: isMobile ? MOBILE_HIT_TARGET_PX : undefined,
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
             {t("chat.close")}
          </button>
        </div>
        <pre
          style={{
            margin: 0,
            padding: 14,
            maxHeight: isMobile ? "none" : "calc(min(760px, 100vh - 40px) - 48px)",
            flex: isMobile ? "1 1 auto" : undefined,
            minHeight: isMobile ? 0 : undefined,
            overflow: "auto",
            background: "var(--bg-panel)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            lineHeight: 1.45,
            whiteSpace: "pre",
          }}
        >
          {(displayLines.length ? displayLines : [""]).map((line, index, allLines) => (
            <Fragment key={index}>
              {renderAnsiLine(line, `line-${index}`)}
              {index < allLines.length - 1 ? "\n" : null}
            </Fragment>
          ))}
        </pre>
      </div>
    </div>
  );
}
