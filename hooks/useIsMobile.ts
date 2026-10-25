"use client";

import { useSyncExternalStore } from "react";
import { isMobileLayout } from "../lib/mobile-layout";

const COARSE_POINTER_QUERY = "(pointer: coarse)";

// 模块级单例：订阅与快照共用同一个 MediaQueryList，避免每次渲染新建查询对象。
let coarsePointerMediaQuery: MediaQueryList | null = null;

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  coarsePointerMediaQuery ??= window.matchMedia(COARSE_POINTER_QUERY);
  window.addEventListener("resize", cb);
  coarsePointerMediaQuery.addEventListener("change", cb);
  return () => {
    window.removeEventListener("resize", cb);
    coarsePointerMediaQuery?.removeEventListener("change", cb);
  };
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  coarsePointerMediaQuery ??= window.matchMedia(COARSE_POINTER_QUERY);
  // 布局视口口径：与 CSS 媒体查询同源。缩放与聚焦放大只改变视觉视口，
  // window.innerWidth 会跟着视觉视口变，导致 JS 与 CSS 的移动档判定错位。
  const root = document.documentElement;
  return isMobileLayout({
    width: root.clientWidth,
    height: root.clientHeight,
    coarsePointer: coarsePointerMediaQuery.matches,
  });
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
