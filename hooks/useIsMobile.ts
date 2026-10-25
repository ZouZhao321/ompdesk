"use client";

import { useSyncExternalStore } from "react";
import { MOBILE_LAYOUT_QUERY } from "../lib/mobile-layout";

// 模块级单例：订阅与快照共用同一个 MediaQueryList，避免每次渲染新建查询对象。
let mobileMediaQuery: MediaQueryList | null = null;

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  mobileMediaQuery ??= window.matchMedia(MOBILE_LAYOUT_QUERY);
  mobileMediaQuery.addEventListener("change", cb);
  return () => {
    mobileMediaQuery?.removeEventListener("change", cb);
  };
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  mobileMediaQuery ??= window.matchMedia(MOBILE_LAYOUT_QUERY);
  // 直接读整条媒体查询：与 CSS 同源，缩放与聚焦放大只改视觉视口也不会错位。
  return mobileMediaQuery.matches;
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Returns true when the viewport belongs to the mobile layout tier.
 * SSR-safe: renders as desktop (false) on the server and first client paint,
 * then syncs to the real viewport after hydration.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
