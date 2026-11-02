"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import {
  RAIL_ROW_PX,
  railDotPitch,
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

/**
 * 提示框的锚点是否还立着：圆点被卸载，或整条跳转条被收起（量到零尺寸），
 * 都让提示无处可对。
 */
function isTipAnchorVisible(element: HTMLElement, column: HTMLElement | null): boolean {
  if (!element.isConnected) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  if (!column) return true;
  const columnRect = column.getBoundingClientRect();
  return rect.bottom > columnRect.top && rect.top < columnRect.bottom;
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
 * 圆点从条目数组的分组结果来，点击只把条目下标交给列表；当前圆点由视口顶部
 * 所在的已挂载条目决定。圆点列铺满上下两条按钮之间的可用高度，数量多时压缩
 * 节距，全部圆点始终露出；节距会小到失去可用命中区时整条收起。移动档与没有
 * 多余车道时由 CSS 隐藏，首帧不会闪现。
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

  // 每条提问都要有一个看得见的圆点：圆点列铺满上下两条按钮之间的高度，放不下时
  // 按数量压缩节距；节距会小于可用命中区下限时整条收起，不把圆点压成一条实线。
  const [dotPitch, setDotPitch] = useState<number | null>(RAIL_ROW_PX);
  const stepBlockRef = useRef(0);
  useLayoutEffect(() => {
    const rail = railRef.current;
    const lane = rail?.parentElement;
    if (!rail || !lane) return;
    const apply = () => {
      const laneHeight = lane.clientHeight;
      if (laneHeight <= 0) return;
      let used = 0;
      for (const step of rail.querySelectorAll(".transcript-rail-step")) {
        used += step.getBoundingClientRect().height;
      }
      let block = stepBlockRef.current;
      if (used > 0) {
        const gapValue = Number.parseFloat(getComputedStyle(rail).rowGap);
        const gap = Number.isFinite(gapValue) ? gapValue : 4;
        block = used + gap * 2;
        stepBlockRef.current = block;
      }
      // 收起状态下量不到按钮，用上一次量到的占位；车道始终在布局里，窗口缩放后
      // 仍能重新判断要不要露出。
      const next = railDotPitch(laneHeight - block, dots.length);
      setDotPitch((current) => (current === next ? current : next));
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(lane);
    return () => observer.disconnect();
  }, [dots.length]);
  const railHidden = dotPitch === null;
  const pitch = dotPitch ?? RAIL_ROW_PX;
  // 节距变小时圆点跟着缩，相邻圆点才不会连成一条实线。
  const dotMarkPx = Math.min(6, Math.max(1, pitch / 2));
  // 圆点用 roving tabindex：Tab 只停在当前圆点上，方向键在圆点之间移动，
  // 长会话不会因为每个圆点都是停留点而挡住键盘用户。
  const activeDotIndex = currentDotIndex >= 0 ? currentDotIndex : 0;
  const handleDotKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let target = index;
    if (event.key === "ArrowUp") target = index - 1;
    else if (event.key === "ArrowDown") target = index + 1;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = dots.length - 1;
    else return;
    event.preventDefault();
    const clamped = Math.min(Math.max(target, 0), dots.length - 1);
    if (clamped === index) return;
    onJump(dots[clamped].itemIndex);
    dotsRef.current?.querySelectorAll<HTMLButtonElement>(".transcript-rail-dot")[clamped]?.focus();
  }, [dots, onJump]);

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

  // 提示框是固定绘制的浮层，位置由锚点重算：只要圆点还挂载着、还在圆点列的可见区里，
  // 任何滚动都只重新对准。转写区的滚动搬不动圆点，跟随开着时每个流式块都会滚一次，
  // 在那条路上收起提示等于让悬停几乎读不到内容。圆点被卸载、被圆点列裁掉，或整条
  // 跳转条被 CSS 收起时才失去锚点。
  const tipVisible = tipAnchor !== null;
  useEffect(() => {
    if (!tipVisible) return;
    let frame = 0;
    // 锚点还立着才谈位置：圆点被卸载、跳转条被收起都收起提示。
    const anchorIsVisible = () => {
      const anchor = anchorRef.current;
      if (!anchor || !isTipAnchorVisible(anchor.element, dotsRef.current)) {
        hideTip();
        return false;
      }
      return true;
    };
    const onScroll = () => {
      if (!anchorIsVisible()) return;
      // 一帧只对一次：连续的滚动事件合并到同一个 rAF 里。
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        positionTip();
      });
    };
    window.addEventListener("scroll", onScroll, true);
    // 缩放、面板拖拽、字体加载与圆点增减都不发滚动事件：竖条或圆点列的尺寸变了，
    // 锚点的纵向位置就变了，浮层却还停在旧位置。尺寸一变就重新对准。
    const observer = new ResizeObserver(() => {
      if (anchorIsVisible()) positionTip();
    });
    if (railRef.current) observer.observe(railRef.current);
    if (dotsRef.current) observer.observe(dotsRef.current);
    // 圆点数组换了：锚点可能已经不在这份列表里，还在就按新位置重算。
    if (anchorIsVisible()) positionTip();
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [tipVisible, dots, positionTip, hideTip]);

  return (
    <div className="transcript-rail-lane">
      <div
        ref={railRef}
        className="transcript-rail"
        role="navigation"
        aria-label={t("chat.transcriptRail")}
        style={railHidden ? { display: "none" } : undefined}
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
        <div
          ref={dotsRef}
          className="transcript-rail-dots"
          style={{
            height: pitch * dots.length,
            "--rail-dot-mark": `${dotMarkPx}px`,
          } as CSSProperties}
        >
          {dots.map((dot, index) => {
            const promptId = `transcript-rail-prompt-${dot.itemIndex}`;
            return (
              <button
                key={dot.itemIndex}
                type="button"
                className="transcript-rail-dot"
                style={{ height: pitch }}
                tabIndex={index === activeDotIndex ? 0 : -1}
                aria-label={t("chat.jumpToPrompt", { index: index + 1 })}
                aria-describedby={promptId}
                aria-current={index === currentDotIndex ? "true" : undefined}
                onClick={() => onJump(dot.itemIndex)}
                onKeyDown={(event) => handleDotKeyDown(event, index)}
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
          <div ref={tipRef} className="transcript-rail-tip" aria-hidden="true">
            {tipAnchor.text}
          </div>
        )}
      </div>
    </div>
  );
}
