import type { AgentMessage } from "@oh-my-pi/pi-agent-core";

const MAX_TITLE_LENGTH = 80;

export interface GeneratedSessionTitle {
  title: string;
}

/** The session fields the display title is derived from. */
export interface SessionTitleSource {
  name?: string;
  firstMessage: string;
  id: string;
}

/**
 * Title shown for a session in the sidebar and the top bar: the stored name,
 * else the first message, else a short id.
 *
 * Callers pass the first message they intend to display; a sidebar row that
 * may hold an SDK-expanded `<skill>` block collapses it with
 * `skillExpansionToCommand` first, so the title matches the rest of the row.
 *
 * This module stays free of SDK imports because client components import it.
 */
export function sessionDisplayTitle({ name, firstMessage, id }: SessionTitleSource): string {
  return name || firstMessage.slice(0, 50) || id.slice(0, 12);
}

/** Narrows one message content block to a text block. */
function isTextBlock(block: unknown): block is { type: "text"; text: string } {
  if (typeof block !== "object" || block === null) return false;
  if (!("type" in block) || block.type !== "text") return false;
  return "text" in block && typeof block.text === "string";
}

/** Plain text of a session message, ignoring images and tool blocks. */
function messageText(message: AgentMessage): string {
  if (!("content" in message)) return "";
  const content = message.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (isTextBlock(block)) parts.push(block.text);
  }
  return parts.join("\n").trim();
}

/** First user turn on the session's current branch. */
export function findFirstUserMessage(messages: readonly AgentMessage[]): string | undefined {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = messageText(message);
    if (text) return text;
  }
  return undefined;
}

/**
 * Text to base a session title on: the first user turn, or — after a full
 * compaction replaced the history — the compaction summary (upstream #381).
 */
export function findFirstTitleSource(messages: readonly AgentMessage[]): string | undefined {
  const userText = findFirstUserMessage(messages);
  if (userText) return userText;
  const summary = (messages as ReadonlyArray<{ role?: string; summary?: unknown }>)
    .find((m) => m.role === "compactionSummary" && typeof m.summary === "string")
    ?.summary as string | undefined;
  return summary?.trim() ? summary : undefined;
}

export function truncateTitle(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  const characters = Array.from(trimmed);
  return characters.length > MAX_TITLE_LENGTH
    ? characters.slice(0, MAX_TITLE_LENGTH).join("").trim()
    : trimmed;
}
