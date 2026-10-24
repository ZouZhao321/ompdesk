"use client";

import { useSyncExternalStore } from "react";

/** Width breakpoint shared with the mobile media query in app/globals.css. */
export const MOBILE_MAX_WIDTH = 768;
/** Height breakpoint for coarse-pointer devices, shared with app/globals.css. */
export const MOBILE_MAX_COARSE_HEIGHT = 480;

const COARSE_POINTER_QUERY = "(pointer: coarse)";

interface MobileLayoutInput {
  width: number;
  height: number;
  coarsePointer: boolean;
}

/**
 * Decides the mobile layout tier. Phones in landscape stay on the mobile
 * layout because their pointer is coarse and the viewport is short.
 */
export function isMobileLayout({ width, height, coarsePointer }: MobileLayoutInput): boolean {
  return width <= MOBILE_MAX_WIDTH || (coarsePointer && height <= MOBILE_MAX_COARSE_HEIGHT);
}

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  window.addEventListener("resize", cb);
  const coarsePointer = window.matchMedia(COARSE_POINTER_QUERY);
  coarsePointer.addEventListener("change", cb);
  return () => {
    window.removeEventListener("resize", cb);
    coarsePointer.removeEventListener("change", cb);
  };
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return isMobileLayout({
    width: window.innerWidth,
    height: window.innerHeight,
    coarsePointer: window.matchMedia(COARSE_POINTER_QUERY).matches,
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
