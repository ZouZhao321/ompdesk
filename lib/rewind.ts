import type { SessionTreeNode } from "./types";
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

function findPath(nodes: SessionTreeNode[], targetId: string): SessionTreeNode[] | null {
  for (const node of nodes) {
    if (node.entry.id === targetId) return [node];
    const childPath = findPath(node.children ?? [], targetId);
    if (childPath) return [node, ...childPath];
  }
  return null;
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
 * 构建当前分支（root → active leaf）上的可选点列表。
 * @param tree 会话树
 * @param activeLeafId 当前活动叶子 entry id
 * @returns 按 root-to-leaf 顺序的消息条目；叶子缺失或未知时为空
 */
export function buildRewindEntries(tree: SessionTreeNode[], activeLeafId: string | null): RewindEntry[] {
  if (!activeLeafId) return [];
  const path = findPath(tree, activeLeafId);
  if (!path) return [];

  const entries: RewindEntry[] = [];
  for (const node of path) {
    const { entry } = node;
    if (entry.type !== "message") continue;
    const kind = toKind(entry.message.role);
    // Bash execution entries carry no content blocks; everything else does.
    const content = "content" in entry.message ? entry.message.content : "";
    entries.push({
      entryId: entry.id,
      kind,
      text: readText(content),
      images: kind === "user" ? readImages(content) : [],
    });
  }
  return entries;
}
