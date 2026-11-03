import type { AssistantContentBlock, AssistantMessage, ThinkingContent, ToolCallContent } from "./types";

export interface DisplayOptions {
  isStreaming?: boolean;
  /** omp's `hideThinkingBlock` setting: drop thinking blocks entirely. */
  hideThinking?: boolean;
}

export function isEmptyThinkingBlock(block: AssistantContentBlock, options: DisplayOptions = {}): block is ThinkingContent {
  return block.type === "thinking" && !block.deferred && !options.isStreaming && block.thinking.trim() === "";
}

/** True for blocks the transcript must not render at all. */
export function isHiddenAssistantBlock(block: AssistantContentBlock, options: DisplayOptions = {}): boolean {
  if (options.hideThinking && block.type === "thinking") return true;
  return isEmptyThinkingBlock(block, options);
}

export function getDisplayableAssistantBlocks(
  message: AssistantMessage,
  options: DisplayOptions = {},
): AssistantContentBlock[] {
  return (message.content ?? []).filter((block) => !isHiddenAssistantBlock(block, options));
}

export function getAssistantErrorMessage(
  message: AssistantMessage,
  options: DisplayOptions = {},
): string | null {
  if (options.isStreaming || message.stopReason !== "error") return null;
  return message.errorMessage?.trim() || "Unknown provider error";
}

function isFinalAnswerBlock(block: AssistantContentBlock): boolean {
  return block.type === "text" || block.type === "image";
}

export function splitFinalAssistantBlocks(
  message: AssistantMessage,
  options: DisplayOptions = {},
): { answerBlocks: AssistantContentBlock[]; processBlocks: AssistantContentBlock[] } {
  const blocks = getDisplayableAssistantBlocks(message, options);
  const lastProcessIndex = blocks.findLastIndex((block) => !isFinalAnswerBlock(block));
  if (lastProcessIndex === -1) {
    return { answerBlocks: blocks, processBlocks: [] };
  }
  return {
    answerBlocks: blocks.slice(lastProcessIndex + 1),
    processBlocks: blocks.slice(0, lastProcessIndex + 1),
  };
}

export function countToolCallBlocks(blocks: AssistantContentBlock[]): number {
  return blocks.filter((block): block is ToolCallContent => block.type === "toolCall").length;
}

/** 思考块展示哪种内容：正文、加载态、错误，还是占位提示。 */
export type ThinkingDisplay = "text" | "loading" | "error" | "placeholder";

/**
 * 思考块展示什么。正文一旦在手就优先渲染：正文已经取回、重新请求却失败时，错误
 * 文案不该把它盖掉，加载态同理。
 */
export function thinkingDisplayState(hasText: boolean, loading: boolean, error: string | null): ThinkingDisplay {
  if (hasText) return "text";
  if (loading) return "loading";
  if (error !== null && error.length > 0) return "error";
  return "placeholder";
}
