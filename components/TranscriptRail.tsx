"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  RAIL_MAX_HEIGHT_PX,
  RAIL_ROW_PX,
  RAIL_WIDTH_PX,
  railScrollTop,
  railStepItemIndex,
  type TranscriptRailDot,
} from "@/lib/transcript-rail";

interface Props {
  dots: readonly TranscriptRailDot[];
  /** 当前圆点下标；-1 表示顶部停在第一轮之前。 */
  currentDotIndex: number;
  /** 跳到某个条目：下标交给列表的定位接口，这里不换算像素。 */
  onJump: (itemIndex: number) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

interface RailTip {
  text: string;
  /** 提示框相对跳转条顶边的位置（px）。 */
  top: number;
}

function Chevron({ direction }: { direction: "up" | "down" }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === "up" ? <path d="m6 15 6-6 6 6" /> : <path d="m6 9 6 6 6-6" />}
    </svg>
  );
}

/**
 * 贴在对话列左外侧的提问跳转条。
 *
 * 圆点从条目数组的分组结果来，点击只把条目下标交给列表；当前圆点由列表报告的
 * 顶部可见条目决定。圆点放不下时容器内部滚动，当前圆点保持在正中。移动档与
 * 没有多余车道时由 CSS 隐藏，首帧不会闪现。
 */
export function TranscriptRail({ dots, currentDotIndex, onJump, t }: Props) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const dotsRef = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<RailTip | null>(null);

  const previousItemIndex = railStepItemIndex(dots, currentDotIndex, -1);
  const nextItemIndex = railStepItemIndex(dots, currentDotIndex, 1);

  useLayoutEffect(() => {
    const container = dotsRef.current;
    if (!container) return;
    container.scrollTop = railScrollTop(currentDotIndex, dots.length, RAIL_MAX_HEIGHT_PX);
  }, [currentDotIndex, dots.length]);

  // 提示框是固定绘制的浮层，转写或圆点列一滚动就失去锚点，直接收起。
  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [tip]);

  const showTip = useCallback((element: HTMLElement, text: string) => {
    const rail = railRef.current;
    if (!rail) return;
    const rect = element.getBoundingClientRect();
    setTip({ text, top: rect.top - rail.getBoundingClientRect().top + rect.height / 2 });
  }, []);

  return (
    <div
      ref={railRef}
      className="transcript-rail"
      role="navigation"
      aria-label={t("chat.transcriptRail")}
      style={{ width: RAIL_WIDTH_PX }}
    >
      <button
        type="button"
        className="transcript-rail-step"
        aria-label={t("chat.previousPrompt")}
        title={t("chat.previousPrompt")}
        disabled={previousItemIndex === null}
        onClick={() => {
          if (previousItemIndex !== null) onJump(previousItemIndex);
        }}
      >
        <Chevron direction="up" />
      </button>
      <div ref={dotsRef} className="transcript-rail-dots" style={{ maxHeight: RAIL_MAX_HEIGHT_PX }}>
        {dots.map((dot, index) => (
          <button
            key={dot.itemIndex}
            type="button"
            className="transcript-rail-dot"
            style={{ height: RAIL_ROW_PX }}
            aria-label={t("chat.jumpToPrompt", { index: index + 1 })}
            aria-current={index === currentDotIndex ? "true" : undefined}
            onClick={() => onJump(dot.itemIndex)}
            onMouseEnter={(event) => showTip(event.currentTarget, dot.prompt)}
            onMouseLeave={() => setTip(null)}
            onFocus={(event) => showTip(event.currentTarget, dot.prompt)}
            onBlur={() => setTip(null)}
          >
            <span className="transcript-rail-dot-mark" aria-hidden="true" />
          </button>
        ))}
      </div>
      <button
        type="button"
        className="transcript-rail-step"
        aria-label={t("chat.nextPrompt")}
        title={t("chat.nextPrompt")}
        disabled={nextItemIndex === null}
        onClick={() => {
          if (nextItemIndex !== null) onJump(nextItemIndex);
        }}
      >
        <Chevron direction="down" />
      </button>
      {tip && (
        <div className="transcript-rail-tip" style={{ top: tip.top, left: RAIL_WIDTH_PX + 8 }} aria-hidden="true">
          {tip.text}
        </div>
      )}
    </div>
  );
}
