import type { Locale } from "./types";

type MessagesByLocale = Record<string, Record<string, string>>;

/**
 * 把设置分组名转成稳定的 key 片段。
 * @param group 服务端返回的分组名
 * @returns 小写、连字符分隔的分组片段；空名称回退为 general
 */
export function groupSlug(group: string): string {
  return group.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "general";
}

/** 设置标签名的翻译 key。 */
export function settingTabKey(tab: string): string {
  return `settings.tab.${tab}`;
}

/** 设置分组标题的翻译 key。 */
export function settingGroupKey(tab: string, group: string): string {
  return `settings.group.${tab}.${groupSlug(group)}`;
}

/** 设置字段名称的翻译 key。 */
export function settingFieldLabelKey(path: string): string {
  return `settings.field.${path}.label`;
}

/** 设置字段说明的翻译 key。 */
export function settingFieldDescriptionKey(path: string): string {
  return `settings.field.${path}.description`;
}

/**
 * 查询设置文案，缺失时回退到服务端返回的原文。
 * @param locale 当前语言
 * @param key 翻译 key
 * @param messages 各语言的消息字典
 * @param fallback 服务端返回的英文原文
 * @returns 显示文案
 */
export function resolveSettingText(
  locale: Locale,
  key: string,
  messages: MessagesByLocale,
  fallback: string,
): string {
  const message = messages[locale]?.[key] ?? messages.en?.[key];
  if (message !== undefined) return message;
  if (process.env.NODE_ENV !== "production") console.warn(`[i18n] Missing setting translation: ${key}`);
  return fallback;
}
