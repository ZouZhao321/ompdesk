"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getCommentDictionaryVersion, subscribeCommentDictionary } from "@/lib/comment-dictionary-version";
import {
	getCommentTranslationPreference,
	subscribeCommentTranslationPreference,
} from "@/lib/comment-translation-preference";

/** 查看器顶部的译文开关，默认关闭。 */
export function useCommentTranslationPreference(): boolean {
	return useSyncExternalStore(subscribeCommentTranslationPreference, getCommentTranslationPreference, () => false);
}

/** 字典版本；保存译文后递增，用作译文渲染缓存的依赖。 */
export function useCommentDictionaryVersion(): number {
	return useSyncExternalStore(subscribeCommentDictionary, getCommentDictionaryVersion, () => 0);
}

/**
 * 按字典键取译文。字典版本变化时重新请求，渲染层不必重新加载源码。
 * 只有可见标签（active）才发起请求，遵循右侧面板的活动约定。
 */
export function useCommentTranslationLookup(keys: readonly string[], active: boolean): Record<string, string> {
	const version = useCommentDictionaryVersion();
	const [translations, setTranslations] = useState<Record<string, string>>({});
	const signature = JSON.stringify(keys);

	useEffect(() => {
		const requested = JSON.parse(signature) as string[];
		if (requested.length === 0) {
			setTranslations({});
			return;
		}
		// 隐藏的标签不发起请求；保留上一次的结果，切回时先按旧值渲染再刷新。
		if (!active) return;

		const controller = new AbortController();
		fetch("/api/comment-dictionary/lookup", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ keys: requested }),
			signal: controller.signal,
		})
			.then(async (response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return (await response.json()) as { translations?: Record<string, string> };
			})
			.then((payload) => setTranslations(payload.translations ?? {}))
			.catch(() => {
				if (!controller.signal.aborted) setTranslations({});
			});

		return () => controller.abort();
	}, [active, signature, version]);

	return translations;
}
