/**
 * 源码视图的换行开关。查看器与注释互译预览共用同一份状态，
 * 预览因此跟随查看器的换行设置。
 */
let wrapLines = false;
const listeners = new Set<() => void>();

export function getSourceWrapLines(): boolean {
  return wrapLines;
}

export function setSourceWrapLines(next: boolean): void {
  if (next === wrapLines) return;
  wrapLines = next;
  for (const listener of [...listeners]) listener();
}

export function subscribeSourceWrapLines(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
