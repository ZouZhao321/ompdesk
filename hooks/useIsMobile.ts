"use client";

import { useSyncExternalStore } from "react";
import { MOBILE_LAYOUT_QUERY } from "../lib/mobile-layout";

// 查询对象由订阅方自己持有并在退订时释放；快照读取不做任何创建或缓存。
function subscribe(onChange: () => void): () => void {
	if (typeof window === "undefined" || !window.matchMedia) return () => {};
	const query = window.matchMedia(MOBILE_LAYOUT_QUERY);
	query.addEventListener("change", onChange);
	return () => {
		query.removeEventListener("change", onChange);
	};
}

function getSnapshot(): boolean {
	if (typeof window === "undefined" || !window.matchMedia) return false;
	// 直接读整条媒体查询：与 CSS 同源，缩放与聚焦放大只改视觉视口也不会错位。
	return window.matchMedia(MOBILE_LAYOUT_QUERY).matches;
}

function getServerSnapshot(): boolean {
	return false;
}

/**
 * 视口是否属于移动档。
 * 服务端与首次客户端绘制返回 false（桌面档），水合后跟随真实视口。
 */
export function useIsMobile(): boolean {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
