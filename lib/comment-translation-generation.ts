/**
 * 勾选条目的批量译文生成。
 *
 * 一次调用只处理传入的条目：先查本机字典，命中的直接返回；剩余条目合成一份
 * 提示词交给模型，逐条校验后再写入字典。模型调用通过 `model.complete` 注入，
 * 路由层负责把它接到真实的运行时模型上。
 */
import { commentEntryKey, normalizeCommentText, type CommentLanguage } from "./comment-entries";
import { readCommentDictionary, saveCommentTranslation, type CommentTranslationRecord } from "./comment-dictionary";
import { validateTranslation, type ProtectedFragment } from "./comment-translation-validation";

/** 勾选条目的最小输入：只有键的原料与语言，不带文件内容。 */
export interface CommentTranslationRequestEntry {
  original: string;
  originalLanguage: CommentLanguage;
  targetLanguage: CommentLanguage;
  /** 已选中的旧译文仍要重新生成时置 true，跳过字典命中。 */
  force?: boolean;
}

export type CommentTranslationFailureReason = "no_output" | "missing_fragments";

export type CommentTranslationEntryResult =
  | { key: string; status: "generated" | "cached"; translation: string }
  | {
      key: string;
      status: "failed";
      reason: CommentTranslationFailureReason;
      missing: ProtectedFragment[];
    };

export interface CommentTranslationGeneration {
  results: CommentTranslationEntryResult[];
  /** 本次被写入或命中的字典记录，按键索引。 */
  translations: Record<string, CommentTranslationRecord>;
}

export interface CommentTranslationModel {
  /** 记录进字典的模型标识，形如 `provider/modelId`。 */
  id: string;
  complete: (prompt: string) => Promise<string>;
}

export interface GenerateCommentTranslationsOptions {
  entries: readonly CommentTranslationRequestEntry[];
  model: CommentTranslationModel;
  agentDir: string;
  /** 测试可注入的写入时间。 */
  now?: Date;
}

interface PendingEntry {
  key: string;
  original: string;
  entry: CommentTranslationRequestEntry;
  /** 任一同键条目要求强制生成时，这一条跳过字典命中。 */
  forced: boolean;
}

interface PromptItem {
  id: number;
  from: CommentLanguage;
  to: CommentLanguage;
  text: string;
}

/** 模型必须返回的 JSON 形状；提示词里给出的示例与此一致。 */
const PROMPT_PREAMBLE = [
  "Translate code comments between Chinese and English.",
  'Reply with JSON only: {"translations":[{"id":1,"translation":"..."}]}',
  "Rules:",
  "- Keep every file path, identifier, number and bracketed fragment exactly as written.",
  "- Translate the prose only; do not add or drop facts.",
  "- One line per translation, without comment markers.",
].join("\n");

/** 单次模型回复的条目上限，避免整页勾选时输出被截断。 */
const MAX_PROMPT_ENTRIES = 40;

function buildTranslationPrompt(entries: readonly PendingEntry[]): string {
  const items: PromptItem[] = entries.map((item, index) => ({
    id: index + 1,
    from: item.entry.originalLanguage,
    to: item.entry.targetLanguage,
    text: item.original,
  }));
  return `${PROMPT_PREAMBLE}\nItems: ${JSON.stringify(items)}`;
}

/**
 * 解析模型回复。允许整段被代码围栏包住，也允许前后存在说明文字；无法解析出
 * 数组时返回 null，由调用方把这一批判为失败而不是写进字典。
 */
function parseModelTranslations(raw: string): Map<number, string> | null {
  const fenced = raw
    .trim()
    .replace(/^```[^\n]*\n?/u, "")
    .replace(/```$/u, "")
    .trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !("translations" in parsed)) return null;
  const list = parsed.translations;
  if (!Array.isArray(list)) return null;

  const translations = new Map<number, string>();
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    if (!("id" in item) || typeof item.id !== "number" || !Number.isInteger(item.id)) continue;
    if (!("translation" in item) || typeof item.translation !== "string") continue;
    const translation = item.translation.replace(/\s*\n\s*/gu, " ").trim();
    if (!translation || translations.has(item.id)) continue;
    translations.set(item.id, translation);
  }
  return translations;
}

/** 键相同即同一句原文与同一目标语言，一次请求里只处理一次；强制标记取并集。 */
function collectPending(entries: readonly CommentTranslationRequestEntry[]): PendingEntry[] {
  const ordered: PendingEntry[] = [];
  const indexByKey = new Map<string, number>();
  for (const entry of entries) {
    const original = normalizeCommentText(entry.original);
    if (!original) continue;
    const key = commentEntryKey(original, entry.targetLanguage);
    const existing = indexByKey.get(key);
    if (existing !== undefined) {
      if (entry.force) ordered[existing].forced = true;
      continue;
    }
    indexByKey.set(key, ordered.length);
    ordered.push({ key, original, entry, forced: entry.force === true });
  }
  return ordered;
}

export async function generateCommentTranslations(
  options: GenerateCommentTranslationsOptions,
): Promise<CommentTranslationGeneration> {
  const dictionary = readCommentDictionary(options.agentDir);
  const ordered = collectPending(options.entries);
  const results = new Map<string, CommentTranslationEntryResult>();
  const translations: Record<string, CommentTranslationRecord> = {};
  const pending: PendingEntry[] = [];

  // 同一句原文同一目标语言已经在字典里，就不再请求模型；强制生成时忽略旧译文。
  for (const item of ordered) {
    const record = item.forced ? undefined : dictionary.translations[item.key];
    if (!record || !record.translation.trim()) {
      pending.push(item);
      continue;
    }
    results.set(item.key, { key: item.key, status: "cached", translation: record.translation });
    translations[item.key] = record;
  }

  if (pending.length > 0) {
    // 一次勾选可能覆盖整页条目；提示词按固定大小分批，避免单次回复被截断。
    for (let offset = 0; offset < pending.length; offset += MAX_PROMPT_ENTRIES) {
      const chunk = pending.slice(offset, offset + MAX_PROMPT_ENTRIES);
      const raw = await options.model.complete(buildTranslationPrompt(chunk));
      const parsed = parseModelTranslations(raw);
      for (const [index, item] of chunk.entries()) {
        const translation = parsed?.get(index + 1) ?? "";
        if (!translation) {
          results.set(item.key, { key: item.key, status: "failed", reason: "no_output", missing: [] });
          continue;
        }
        const validation = validateTranslation(item.original, translation);
        if (!validation.ok) {
          results.set(item.key, {
            key: item.key,
            status: "failed",
            reason: "missing_fragments",
            missing: validation.missing,
          });
          continue;
        }
        const record = saveCommentTranslation(options.agentDir, {
          original: item.original,
          originalLanguage: item.entry.originalLanguage,
          targetLanguage: item.entry.targetLanguage,
          translation,
          origin: "model",
          model: options.model.id,
          ...(options.now ? { now: options.now } : {}),
        });
        translations[record.key] = record;
        results.set(item.key, { key: record.key, status: "generated", translation: record.translation });
      }
    }
  }

  const orderedResults: CommentTranslationEntryResult[] = [];
  for (const item of ordered) {
    const result = results.get(item.key);
    if (result) orderedResults.push(result);
  }
  return { results: orderedResults, translations };
}
