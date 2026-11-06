import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import {
  FOLLOW_BOTTOM_THRESHOLD_PX,
  FOLLOW_OBSERVATION_HOLD_MS,
  reduceFollow,
} from "../lib/transcript-follow.ts";
import { source, callbackSource } from "./useAgentSession.test-support.mjs";

const CALLBACKS = [
  "applyFollow",
  "holdFollowObservation",
  "releaseFollowObservation",
  "handleScrollPositionChange",
];

// 只剥掉 TypeScript 语法；判定（reduceFollow）、抑制器与滚动观测的接线都是真的，
// 意图窗口、滚动元素、滚动入口与状态落点是 doubles。
const { outputText } = ts.transpileModule(
  CALLBACKS.map((name) => `const ${name} = ${callbackSource(name)};`).join("\n"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
);

function harness({
  intentUntil = 0,
  scrollHeight = 4000,
  clientHeight = 800,
  now = () => Date.now(),
} = {}) {
  const container = { scrollHeight, clientHeight, scrollTop: scrollHeight - clientHeight };
  const intentUntilRef = { current: intentUntil };
  const followStates = [];
  const scrolls = [];
  let paused = false;
  const callbacks = new Function(
    "reduceFollow",
    "userScrollIntentUntilRef",
    "followObservationHeldRef",
    "followObservationHoldUntilRef",
    "scrollContainerRef",
    "lastScrollRef",
    "setAutoFollow",
    "scrollToBottom",
    "FOLLOW_OBSERVATION_HOLD_MS",
    "Date",
    `${outputText}\nreturn {
      applyFollow, holdFollowObservation, releaseFollowObservation, handleScrollPositionChange,
    };`,
  )(
    reduceFollow,
    intentUntilRef,
    { current: false },
    { current: 0 },
    { current: container },
    { current: null },
    (following) => {
      // 与生产 setAutoFollowPaused 一致：同一个值不产生状态变化。
      if (paused === !following) return;
      paused = !following;
      followStates.push(following);
    },
    (behavior) => scrolls.push({ behavior, intentUntilAtScroll: intentUntilRef.current }),
    FOLLOW_OBSERVATION_HOLD_MS,
    // 回调里的 Date 走这个替身：截止时间与意图窗口的先后由用例摆布。
    { now },
  );

  return {
    ...callbacks,
    followStates,
    scrolls,
    intentUntilRef,
    isPaused: () => paused,
    // 一次滚动观测：把视口挪到距底部 distanceFromBottom 的位置再读一次。
    reading(distanceFromBottom) {
      container.scrollTop = scrollHeight - clientHeight - distanceFromBottom;
      callbacks.handleScrollPositionChange();
    },
  };
}

test("clears the user scroll intent window before a submitted prompt pulls to the end", () => {
  const h = harness({ intentUntil: Date.now() + 1200 });

  // 用户在意图窗口里上滚后按回车：回底的滚动是程序化的，不能算成又一次用户上滚，
  // 否则跟随会立刻被判回暂停、视图停在历史中间。
  h.applyFollow({ type: "submit" });

  assert.deepEqual(h.scrolls, [{ behavior: "auto", intentUntilAtScroll: 0 }]);
  // 「提交」本来就处于跟随中：生产 setter 会去重，这里同样不产生状态变化。
  assert.deepEqual(h.followStates, []);
  assert.equal(h.isPaused(), false);
  assert.equal(h.intentUntilRef.current, 0);
});

test("clears the intent window for the jump-to-bottom event too", () => {
  const h = harness({ intentUntil: Date.now() + 1200 });

  h.applyFollow({ type: "resume" });

  assert.deepEqual(h.scrolls, [{ behavior: "smooth", intentUntilAtScroll: 0 }]);
  assert.equal(h.intentUntilRef.current, 0);
});

test("recovers an idle jump's pause once the user drags back to the bottom", () => {
  const h = harness();
  // 空闲期点圆点跳转：停掉跟随，合上抑制器，落点由列表带出来。
  h.applyFollow({ type: "pause" });
  h.holdFollowObservation();
  assert.equal(h.isPaused(), true);

  // 落点贴在底部也不改开关：这串位置说明不了用户意图。
  h.reading(0);
  assert.equal(h.isPaused(), true);

  // 列表停稳（或兜底定时器到期）松开抑制器。
  h.releaseFollowObservation();
  // 空闲期手动滑回底部：先离开底部、再朝末尾滑进贴底距离，位置真的在变才恢复。
  h.reading(FOLLOW_BOTTOM_THRESHOLD_PX + 200);
  assert.equal(h.isPaused(), true);
  h.reading(FOLLOW_BOTTOM_THRESHOLD_PX);
  assert.equal(h.isPaused(), false);
});

test("recovers following when inertia reaches the bottom after the intent window expires", () => {
  // 窗口早已过期（intentUntil 为 0），惯性滚动与拖滚动条都不会再刷新它。
  const h = harness({ intentUntil: 0 });
  h.reading(FOLLOW_BOTTOM_THRESHOLD_PX + 200);
  assert.equal(h.isPaused(), false, "expired intent cannot pause follow");

  h.applyFollow({ type: "pause" });
  h.reading(0);

  assert.equal(h.isPaused(), false);
  // 恢复不下发滚动：位置已经在底部，别再把视图拽一次。
  assert.deepEqual(h.scrolls, []);
});

test("keeps a jump paused when its landing sits inside the bottom threshold", () => {
  const h = harness();
  h.applyFollow({ type: "pause" });
  h.holdFollowObservation();

  // 跳到最后一轮：落点就在贴底距离内，抑制器必须把它挡在判定之外，否则刚停掉的
  // 跟随会被抹掉，「回到底部」按钮不再出现。
  h.reading(FOLLOW_BOTTOM_THRESHOLD_PX);
  h.reading(0);

  assert.equal(h.isPaused(), true);
  assert.deepEqual(h.followStates, [false]);
});

test("reads the scroll position no matter whether the session is running", () => {
  const handler = callbackSource("handleScrollPositionChange");

  // 按运行状态早退会让空闲期跳转停掉的跟随永远等不到恢复：观测本身与运行状态无关。
  assert.doesNotMatch(handler, /agentRunningRef|bashRunningRef/);
  assert.match(
    handler,
    /if \(followObservationHeldRef\.current && Date\.now\(\) < followObservationHoldUntilRef\.current\)\s*return;/,
  );
  // 到期收回走同一个松开入口：合上状态与截止时间的写入只有 releaseFollowObservation 一处。
  assert.match(
    handler,
    /if \(followObservationHeldRef\.current\) \{[\s\S]*?releaseFollowObservation\(\);/,
  );
  assert.match(
    handler,
    /distanceFromBottom: container\.scrollHeight - container\.scrollTop - container\.clientHeight/,
  );
});

test("bounds the observation hold with a deadline", () => {
  // 抑制器只能由外部松开：漏配对时它必须自己到点失效，否则跟随既不能暂停也不能恢复。
  // 截止时长只有 lib/transcript-follow.ts 一处来源，hook 与测试共用。
  assert.match(
    source,
    /import \{ FOLLOW_OBSERVATION_HOLD_MS, reduceFollow, type FollowEvent,? \} from "@\/lib\/transcript-follow";/,
  );
  assert.match(
    callbackSource("holdFollowObservation"),
    /followObservationHeldRef\.current = true;\s*followObservationHoldUntilRef\.current = Date\.now\(\) \+ FOLLOW_OBSERVATION_HOLD_MS;/,
  );
  // 正常松开时把截止时间一起清掉，下一次合上重新计时。
  assert.match(
    callbackSource("releaseFollowObservation"),
    /followObservationHeldRef\.current = false;\s*followObservationHoldUntilRef\.current = 0;/,
  );
});

test("recovers following once a forgotten hold expires", () => {
  let clock = 1_000_000;
  const h = harness({ now: () => clock });
  // 空闲期点圆点跳转：停掉跟随并合上抑制器，之后没有任何一次 release。
  h.applyFollow({ type: "pause" });
  h.holdFollowObservation();

  // 窗口内照旧挡住落点：贴底也不恢复。
  clock += 100;
  h.reading(0);
  assert.equal(h.isPaused(), true);

  // 过了截止时间，滚动观测自己收回抑制器：位置重新参与判定。
  clock += FOLLOW_OBSERVATION_HOLD_MS;
  h.reading(100);
  assert.equal(h.isPaused(), true);
  // 位置真的滑到底才把跟随带回来；只有高度变化不算。
  h.reading(0);
  assert.equal(h.isPaused(), false);
  // 恢复不下发滚动：位置已经到底，别再把视图拽一次。
  assert.deepEqual(h.scrolls, []);
});
