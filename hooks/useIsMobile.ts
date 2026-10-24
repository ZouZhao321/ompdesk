"use client";

import { useSyncExternalStore } from "react";
import { isMobileLayout } from "../lib/mobile-layout";

const COARSE_POINTER_QUERY = "(pointer: coarse)";

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
