import { commentEntryKey, type CommentEntry, type CommentLanguage } from "./comment-entries";
import type { Locale } from "./i18n/types";

/** 界面语言对应的译文目标语言。 */
export function commentTranslationTarget(locale: Locale): CommentLanguage {
  return locale === "zh-CN" ? "zh" : "en";
}

/**
 * 词条的译文键。原文语言与目标语言相同时不需要译文，返回 null，
 * 这样中英界面下都不会为自己已能读懂的那一栏查字典。
 */
export function commentTranslationKey(entry: CommentEntry, targetLanguage: CommentLanguage): string | null {
  if (entry.language === targetLanguage) return null;
  return commentEntryKey(entry.text, targetLanguage);
}

/** 查看器要查询的译文键，按词条顺序去重。 */
export function commentTranslationKeys(
  entries: readonly CommentEntry[],
  targetLanguage: CommentLanguage,
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = commentTranslationKey(entry, targetLanguage);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

/** 一条译文行的定位：挂在该词条结束行之后，本身不占源码行号。 */
export interface CommentTranslationRow {
  /** 1 起始的源码行号，始终是已存在的源码行。 */
  line: number;
  text: string;
}

/**
 * 计算一份源码上要插入的译文行。
 *
 * 结果以已有源码行号为键：译文行跟随词条结束行渲染，不新增行号，
 * 因此开关是否打开都不影响选区到行号的映射。开关关闭时返回空结果为
 * 「原样显示」，调用方无需另走一条渲染路径。
 */
export function commentTranslationRows({
  entries,
  translations,
  targetLanguage,
  enabled,
}: {
  entries: readonly CommentEntry[];
  translations: Readonly<Record<string, string>>;
  targetLanguage: CommentLanguage;
  enabled: boolean;
}): Map<number, string> {
  const rows = new Map<number, string>();
  if (!enabled) return rows;

  for (const entry of entries) {
    const key = commentTranslationKey(entry, targetLanguage);
    if (!key) continue;
    const translation = translations[key]?.trim();
    if (!translation) continue;
    rows.set(entry.endLine, translation);
  }
  return rows;
}
