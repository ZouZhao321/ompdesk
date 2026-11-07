import type { AgentMessage } from "./types";
import type { ChatDraftImage } from "./draft-store";
import { isBase64ImageWithinLimits } from "./image-attachments";

export interface RewindEntry {
  entryId: string;
  text: string;
  images: ChatDraftImage[];
}

export type RewindPlan = { handled: true; error: string } | { handled: true; action: "openRewind" };

/**
 * 根据会话忙碌状态决定 /rewind 与 /branch 的处理结果。
 * @param state 当前 agent 与 shell 的运行状态
 * @returns 忙碌时返回错误；否则要求打开回退选点
 */
export function planRewindCommand(state: {
  agentRunning: boolean;
  bashRunning: boolean;
}): RewindPlan {
  if (state.agentRunning || state.bashRunning) {
    return { handled: true, error: "Cannot rewind while the session is busy" };
  }
  return { handled: true, action: "openRewind" };
}

/**
 * 把 `branch` 归一为 `rewind`：`/branch` 是 `/rewind` 的别名，命令面板只注册 `/rewind`。
 * @param name 斜杠命令名（不含前导斜杠）
 * @returns 归一后的命令名；其余命令原样返回
 */
export function normalizeRewindCommand(name: string): string {
  return name === "branch" ? "rewind" : name;
}

/**
 * 判断整条输入是否就是 `/rewind` 或 `/branch`（允许尾部空白）。
 * 带参数时仍交给模型侧解释，避免吞掉用户真正想发出去的内容。
 * @param message 输入框中的原始文本
 * @returns 属于回退命令时为 true
 */
export function isRewindInput(message: string): boolean {
  return /^\/(?:rewind|branch)\s*$/.test(message);
}

function readText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (
      "type" in block &&
      block.type === "text" &&
      "text" in block &&
      typeof block.text === "string"
    ) {
      parts.push(block.text);
    }
  }
  return parts.join("\n");
}

function readImages(content: unknown): ChatDraftImage[] {
  if (!Array.isArray(content)) return [];
  const images: ChatDraftImage[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (!("type" in block) || block.type !== "image") continue;

    let data: unknown;
    let mimeType: unknown;
    if ("source" in block) {
      // 当前 pi-ai 图片格式：source 内嵌 base64 数据。
      const source = block.source;
      if (source && typeof source === "object" && "type" in source && source.type === "base64") {
        data = "data" in source ? source.data : undefined;
        mimeType = "media_type" in source ? source.media_type : undefined;
      }
    } else {
      // 旧版扁平图片格式。
      data = "data" in block ? block.data : undefined;
      mimeType = "mimeType" in block ? block.mimeType : undefined;
    }
    if (typeof data !== "string" || typeof mimeType !== "string") continue;

    const image = { data, mimeType };
    if (isBase64ImageWithinLimits(image)) images.push(image);
  }
  return images;
}

/**
 * 构建当前分支上可撤销的目标。
 * 只暴露最后一条用户消息：更早的消息一旦撤销，会作废它之后已建立的 KV 缓存前缀。
 * @param messages 当前活动分支的消息正文
 * @param entryIds 与消息按下标一一对应的会话 entry id
 * @returns 至多一个条目；最后一条用户消息缺少 entry id 时返回空
 */
export function buildRewindEntries(
  messages: AgentMessage[],
  entryIds: readonly string[],
): RewindEntry[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const entryId = entryIds[index];
    // 不能退而求其次选更早的用户消息，否则会绕过只撤销一轮的限制。
    if (!entryId) return [];
    // Bash 执行消息没有 content 字段；用户消息带有内容块。
    const content = "content" in message ? message.content : "";
    return [{ entryId, text: readText(content), images: readImages(content) }];
  }
  return [];
}
