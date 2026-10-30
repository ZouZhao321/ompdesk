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
  /**
   * 跳转条是否真的可见。移动档与窄转写区由 CSS 收起，可见性因此由本组件自己量，
   * 调用方据此跳过不可见时的测量。
   */
  onVisibilityChange?: (visible: boolean) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

/** 提示框当前对准的元素：滚动后用它重新算位置，而不是丢掉提示。 */
interface TipAnchor {
  element: HTMLElement;
  text: string;
}

function Chevron({ direction }: { direction: "up" | "down" }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === "up" ? <path d="m6 15 6-6 6 6" /> : <path d="m6 9 6 6 6-6" />}
    </svg>
  );
}

/**
 * 贴在对话列右外侧的提问跳转条。
 *
 * 圆点从条目数组的分组结果来，点击只把条目下标交给列表；当前圆点由列表报告的
 * 顶部可见条目决定。圆点放不下时容器内部滚动，当前圆点保持在正中。移动档与
 * 没有多余车道时由 CSS 隐藏，首帧不会闪现。
 */
export function TranscriptRail({ dots, currentDotIndex, onJump, onVisibilityChange, t }: Props) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const dotsRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<TipAnchor | null>(null);
  // 提示框只由锚点驱动：位置是 DOM 写入，不进状态。
  const [tipAnchor, setTipAnchor] = useState<TipAnchor | null>(null);

  const previousItemIndex = railStepItemIndex(dots, currentDotIndex, -1);
  const nextItemIndex = railStepItemIndex(dots, currentDotIndex, 1);

  // 圆点列的实际高度可能被上下两条按钮挤到上限值以下，滚动位置按量到的算。
  useLayoutEffect(() => {
    const container = dotsRef.current;
    if (!container) return;
    const apply = () => {
      container.scrollTop = railScrollTop(currentDotIndex, dots.length, container.clientHeight);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(container);
    return () => observer.disconnect();
  }, [currentDotIndex, dots.length]);

  // 移动档与窄转写区都用 display: none 收起，量到零尺寸即不可见。
  const visibilityListenerRef = useRef(onVisibilityChange);
  visibilityListenerRef.current = onVisibilityChange;
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const report = () => {
      const rect = rail.getBoundingClientRect();
      visibilityListenerRef.current?.(rect.width > 0 && rect.height > 0);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(rail);
    return () => {
      observer.disconnect();
      visibilityListenerRef.current?.(false);
    };
  }, []);

  // 提示框的位置只写进 DOM：滚动时每帧都 setState 会连带整条竖条重渲染，
  // 而这里只挪一个浮层，React 不必知道它挪到了哪。
  const positionTip = useCallback(() => {
    const anchor = anchorRef.current;
    const element = tipRef.current;
    const rail = railRef.current;
    if (!anchor || !element || !rail) return;
    const rect = anchor.element.getBoundingClientRect();
    element.style.top = `${rect.top - rail.getBoundingClientRect().top + rect.height / 2}px`;
  }, []);

  const showTip = useCallback((element: HTMLElement, text: string) => {
    const anchor = { element, text };
    anchorRef.current = anchor;
    setTipAnchor(anchor);
  }, []);

  const hideTip = useCallback(() => {
    anchorRef.current = null;
    setTipAnchor(null);
  }, []);

  // 首帧在绘制前就对到锚点上。
  useLayoutEffect(() => {
    if (tipAnchor !== null) positionTip();
  }, [tipAnchor, positionTip]);

  // 提示框是固定绘制的浮层：转写滚动后锚点失效就收起。两种例外都只需重新对准：
  // 圆点列自己滚动（Tab 到容器外的圆点时浏览器会把它滚进来），以及圆点仍持有
  // 键盘焦点（回车跳转会滚转写，但焦点圆点没动，提示不该跟着消失）。
  const tipVisible = tipAnchor !== null;
  useEffect(() => {
    if (!tipVisible) return;
    let frame = 0;
    const onScroll = (event: Event) => {
      const anchor = anchorRef.current;
      if (!anchor) {
        hideTip();
        return;
      }
      const insideRail = dotsRef.current?.contains(event.target as Node) ?? false;
      const stillFocused = anchor.element.ownerDocument.activeElement === anchor.element;
      if (insideRail || stillFocused) {
        // 一帧只对一次：连续的滚动事件合并到同一个 rAF 里。
        if (frame !== 0) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          positionTip();
        });
        return;
      }
      hideTip();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [tipVisible, positionTip, hideTip]);

  return (
    <div className="transcript-rail-lane">
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
          {dots.map((dot, index) => {
            const promptId = `transcript-rail-prompt-${dot.itemIndex}`;
            return (
              <button
                key={dot.itemIndex}
                type="button"
                className="transcript-rail-dot"
                style={{ height: RAIL_ROW_PX }}
                aria-label={t("chat.jumpToPrompt", { index: index + 1 })}
                aria-describedby={promptId}
                aria-current={index === currentDotIndex ? "true" : undefined}
                onClick={() => onJump(dot.itemIndex)}
                onMouseEnter={(event) => showTip(event.currentTarget, dot.prompt)}
                onMouseLeave={hideTip}
                onFocus={(event) => showTip(event.currentTarget, dot.prompt)}
                onBlur={hideTip}
              >
                <span className="transcript-rail-dot-mark" aria-hidden="true" />
                {/* 提示框是 aria-hidden 的浮层，提问内容另放一份只给屏幕阅读器读。 */}
                <span id={promptId} className="transcript-rail-prompt">
                  {t("chat.jumpToPromptDescription", { index: index + 1, prompt: dot.prompt })}
                </span>
              </button>
            );
          })}
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
        {tipAnchor && (
          <div ref={tipRef} className="transcript-rail-tip" style={{ right: RAIL_WIDTH_PX + 8 }} aria-hidden="true">
            {tipAnchor.text}
          </div>
        )}
      </div>
    </div>
  );
}
