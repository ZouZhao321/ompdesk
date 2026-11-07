"use client";

import { useSyncExternalStore } from "react";
import { getSourceWrapLines, subscribeSourceWrapLines } from "@/lib/source-wrap-preference";

/** 源码视图的换行开关；查看器与注释预览订阅同一份状态。 */
export function useSourceWrapLines(): boolean {
	return useSyncExternalStore(subscribeSourceWrapLines, getSourceWrapLines, () => false);
}
