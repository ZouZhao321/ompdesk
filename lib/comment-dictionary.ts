import { existsSync, mkdirSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { writePrivateFileAtomicSync } from "./atomic-file";
import {
  commentEntryKey,
  isCommentLanguage,
  normalizeCommentText,
  translationTargetLanguage,
  type CommentEntry,
  type CommentLanguage,
} from "./comment-entries";

/** 译文来源：模型生成或人工修改。 */
export type CommentTranslationOrigin = "model" | "manual";

export interface CommentTranslationRecord {
  /** 归一化后的整块注释文本 + 目标语言。 */
  key: string;
  /** 归一化后的原文。 */
  original: string;
  originalLanguage: CommentLanguage;
  targetLanguage: CommentLanguage;
  translation: string;
  origin: CommentTranslationOrigin;
  /** 生成译文的模型；人工修改为 null。 */
  model: string | null;
  /** ISO 8601 时间戳。 */
  updatedAt: string;
}

export interface CommentDictionary {
  version: 1;
  translations: Record<string, CommentTranslationRecord>;
}

export interface CommentTranslationInput {
  original: string;
  originalLanguage: CommentLanguage;
  targetLanguage: CommentLanguage;
  translation: string;
  origin: CommentTranslationOrigin;
  /** 仅当 origin 为 model 时记录。 */
  model?: string | null;
  /** 测试可注入的写入时间。 */
  now?: Date;
}

const DICTIONARY_FILE = "ompdesk-comment-dictionary.json";

export function commentDictionaryFilePath(agentDir: string): string {
  return join(agentDir, DICTIONARY_FILE);
}

function toRecord(value: unknown): CommentTranslationRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  if (!("key" in value) || typeof value.key !== "string") return null;
  if (!("original" in value) || typeof value.original !== "string") return null;
  if (!("translation" in value) || typeof value.translation !== "string") return null;
  if (!("updatedAt" in value) || typeof value.updatedAt !== "string") return null;
  if (!("originalLanguage" in value) || !isCommentLanguage(value.originalLanguage)) return null;
  if (!("targetLanguage" in value) || !isCommentLanguage(value.targetLanguage)) return null;
  if (!("origin" in value) || (value.origin !== "model" && value.origin !== "manual")) return null;
  const model = "model" in value && typeof value.model === "string" ? value.model : null;
  return {
    key: value.key,
    original: value.original,
    originalLanguage: value.originalLanguage,
    targetLanguage: value.targetLanguage,
    translation: value.translation,
    origin: value.origin,
    model,
    updatedAt: value.updatedAt,
  };
}

/** 读取本机字典；文件不存在时返回空字典。损坏的文件直接抛错，不静默清空。 */
export function readCommentDictionary(agentDir: string): CommentDictionary {
  const file = commentDictionaryFilePath(agentDir);
  if (!existsSync(file)) return { version: 1, translations: {} };

  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (
    typeof parsed !== "object"
    || parsed === null
    || Array.isArray(parsed)
    || !("translations" in parsed)
  ) {
    throw new Error(`Invalid comment dictionary: ${file}`);
  }
  const stored = parsed.translations;
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    throw new Error(`Invalid comment dictionary: ${file}`);
  }

  const translations: Record<string, CommentTranslationRecord> = {};
  for (const [key, value] of Object.entries(stored)) {
    const record = toRecord(value);
    if (record && record.key === key) translations[key] = record;
  }
  return { version: 1, translations };
}

/** 保存一条译文。键相同的记录被覆盖，原文按归一化结果存储。 */
export function saveCommentTranslation(agentDir: string, input: CommentTranslationInput): CommentTranslationRecord {
  const original = normalizeCommentText(input.original);
  if (!original) throw new Error("Comment text must not be empty");
  const translation = input.translation.trim();
  if (!translation) throw new Error("Translation must not be empty");
  if (input.originalLanguage === input.targetLanguage) {
    throw new Error("Translation target language must differ from the original language");
  }
  const model = input.model?.trim() ?? "";
  if (input.origin === "model" && !model) {
    throw new Error("Model-generated translations must record the model");
  }

  const key = commentEntryKey(original, input.targetLanguage);
  const record: CommentTranslationRecord = {
    key,
    original,
    originalLanguage: input.originalLanguage,
    targetLanguage: input.targetLanguage,
    translation,
    origin: input.origin,
    model: input.origin === "model" ? model : null,
    updatedAt: (input.now ?? new Date()).toISOString(),
  };

  const dictionary = readCommentDictionary(agentDir);
  mkdirSync(agentDir, { recursive: true });
  writePrivateFileAtomicSync(
    commentDictionaryFilePath(agentDir),
    `${JSON.stringify({ version: 1, translations: { ...dictionary.translations, [key]: record } }, null, 2)}\n`,
  );
  return record;
}

/** 删除整个字典；返回是否真的删掉了文件。 */
export function deleteCommentDictionary(agentDir: string): boolean {
  const file = commentDictionaryFilePath(agentDir);
  if (!existsSync(file)) return false;
  unlinkSync(file);
  return true;
}

/**
 * 只返回当前项目词条对应的译文。字典跨项目共用，面板不显示别的项目的内容。
 */
export function translationsForEntries(
  entries: readonly CommentEntry[],
  dictionary: CommentDictionary,
): Record<string, CommentTranslationRecord> {
  const result: Record<string, CommentTranslationRecord> = {};
  for (const entry of entries) {
    const key = commentEntryKey(entry.text, translationTargetLanguage(entry.language));
    const record = dictionary.translations[key];
    if (record) result[key] = record;
  }
  return result;
}
