import type { AgentMessage } from "./types";
import type { ChatDraftImage } from "./draft-store";
import { isBase64ImageWithinLimits } from "./image-attachments";

export type RewindEntryKind = "user" | "assistant" | "tool" | "other";

export interface RewindEntry {
  entryId: string;
  kind: RewindEntryKind;
  text: string;
  images: ChatDraftImage[];
}

export type RewindPlan =
  | { handled: true; error: string }
  | { handled: true; action: "openRewind" };

/**
 * 判断斜杠命令名是否触发回退选点。
 * @param name 不含斜杠的命令名
 * @returns 命令名（去空白、忽略大小写）为 branch 或 rewind 时为 true
 */
export function isRewindCommand(name: string): boolean {
  const command = name.trim().toLowerCase();
  return command === "branch" || command === "rewind";
}

/**
 * 根据会话忙碌状态决定 /rewind 与 /branch 的处理结果。
 * @param state 当前 agent 与 shell 的运行状态
 * @returns 忙碌时返回错误；否则要求打开回退选点
 */
export function planRewindCommand(state: { agentRunning: boolean; bashRunning: boolean }): RewindPlan {
  if (state.agentRunning || state.bashRunning) {
    return { handled: true, error: "Cannot rewind while the session is busy" };
  }
  return { handled: true, action: "openRewind" };
}

function toKind(role: unknown): RewindEntryKind {
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  if (role === "toolResult") return "tool";
  return "other";
}

function readText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if ("type" in block && block.type === "text" && "text" in block && typeof block.text === "string") {
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
 * 构建当前分支正文上的可选点列表。
 * @param messages 当前活动分支的消息正文
 * @param entryIds 与消息按下标一一对应的会话 entry id
 * @returns 按消息顺序的条目；缺少 entry id 的消息跳过
 */
export function buildRewindEntries(messages: AgentMessage[], entryIds: readonly string[]): RewindEntry[] {
  const entries: RewindEntry[] = [];
  const count = Math.min(messages.length, entryIds.length);
  for (let index = 0; index < count; index += 1) {
    const entryId = entryIds[index];
    if (!entryId) continue;
    const message = messages[index];
    const kind = toKind(message.role);
    // Bash 执行消息没有 content 字段；其余消息都带有内容块。
    const content = "content" in message ? message.content : "";
    entries.push({
      entryId,
      kind,
      text: readText(content),
      images: kind === "user" ? readImages(content) : [],
    });
  }
  return entries;
}
