import type { Locale, TranslationParams } from "./types";

type MessagesByLocale = Record<string, Record<string, string>>;

/** 缺失提示只打印一次，避免每个字段、每次输入都刷屏。 */
const warnedMissingKeys = new Set<string>();

/**
 * 替换翻译消息中的简单插值占位符。
 * @param message 原始翻译消息
 * @param params 插值参数
 * @returns 完成参数替换后的消息
 */
export function interpolateMessage(message: string, params: TranslationParams = {}): string {
	return message.replace(/\{([\w.-]+)\}/g, (token, name: string) => {
		const value = params[name];
		return value === undefined ? token : String(value);
	});
}

/**
 * 从当前语言和英语语言包中解析消息，缺失时返回调用方给出的原文。
 * @param locale 当前语言
 * @param key 翻译 key
 * @param messages 各语言的消息字典
 * @param fallback 缺失时使用的原文
 * @returns 翻译结果或 fallback
 */
export function translateOrFallback(locale: Locale, key: string, messages: MessagesByLocale, fallback: string): string {
	const message = messages[locale]?.[key] ?? messages.en?.[key];
	if (message !== undefined) return message;
	if (process.env.NODE_ENV !== "production" && !warnedMissingKeys.has(key)) {
		warnedMissingKeys.add(key);
		console.warn(`[i18n] Missing translation: ${key}`);
	}
	return fallback;
}

/**
 * 从当前语言和英语语言包中解析消息。
 * @param locale 当前语言
 * @param key 翻译 key
 * @param messages 各语言的消息字典
 * @param params 可选的插值参数
 * @returns 翻译结果，缺失时返回 key
 */
export function translateMessage(
	locale: Locale,
	key: string,
	messages: MessagesByLocale,
	params: TranslationParams = {},
): string {
	return interpolateMessage(translateOrFallback(locale, key, messages, key), params);
}

/**
 * 按当前语言格式化相对时间。
 * @param date 要格式化的时间
 * @param locale 当前语言
 * @param now 用于测试或特殊场景的当前时间
 * @returns locale-aware 的相对时间文本
 */
export function formatRelativeTime(date: Date | string, locale: Locale, now = new Date()): string {
	const target = date instanceof Date ? date : new Date(date);
	const diffMs = target.getTime() - now.getTime();
	const absMs = Math.abs(diffMs);
	const [unit, divisor] =
		absMs < 60_000
			? ["second", 1_000]
			: absMs < 3_600_000
				? ["minute", 60_000]
				: absMs < 86_400_000
					? ["hour", 3_600_000]
					: ["day", 86_400_000];
	const value = Math.round(diffMs / divisor);
	return new Intl.RelativeTimeFormat(locale, { numeric: "always" }).format(value, unit as Intl.RelativeTimeFormatUnit);
}
