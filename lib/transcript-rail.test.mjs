import test from "node:test";
import assert from "node:assert/strict";

async function loadSubject() {
  return import("./transcript-rail.ts");
}

/** 条目数组里只有分组字段参与跳转条，其余字段与本模块无关。 */
function item(anchorIndex, isAnchor) {
  return { key: `entry-${anchorIndex}`, anchorIndex, isAnchor };
}

function prompts(texts) {
  return (entry) => texts[entry.anchorIndex] ?? null;
}

test("puts one dot on every anchored turn and skips the rest", async () => {
  const { buildTranscriptRailDots } = await loadSubject();
  const items = [
    item(-1, false),
    item(0, true),
    item(1, false),
    item(2, true),
  ];

  const dots = buildTranscriptRailDots(items, prompts({ 0: "第一条提问", 2: "第二条提问" }));

  assert.deepEqual(dots, [
    { itemIndex: 1, prompt: "第一条提问" },
    { itemIndex: 3, prompt: "第二条提问" },
  ]);
});

test("drops anchors without prompt text, such as a compaction summary", async () => {
  const { buildTranscriptRailDots } = await loadSubject();
  const items = [item(0, true), item(4, true), item(9, true)];

  const dots = buildTranscriptRailDots(items, prompts({ 0: "提问", 4: "   ", 9: "另一个提问" }));

  assert.deepEqual(dots.map((dot) => dot.itemIndex), [0, 2]);
});

test("keeps the head of a long prompt for the hover tip", async () => {
  const { buildTranscriptRailDots } = await loadSubject();
  // 提示里最多保留 160 个字符，超出的部分由两行省略收起。
  const promptChars = 160;
  const long = "提问".repeat(promptChars);

  const [dot] = buildTranscriptRailDots([item(0, true)], prompts({ 0: long }));

  assert.equal(Array.from(dot.prompt).length, promptChars);
});

test("highlights the dot of the turn the viewport top sits in", async () => {
  const { railCurrentDotIndex } = await loadSubject();
  const dots = [{ itemIndex: 0 }, { itemIndex: 4 }, { itemIndex: 9 }].map((dot) => ({ ...dot, prompt: "" }));

  assert.equal(railCurrentDotIndex(dots, 0, false), 0);
  assert.equal(railCurrentDotIndex(dots, 6, false), 1);
  assert.equal(railCurrentDotIndex(dots, 9, false), 2);
  assert.equal(railCurrentDotIndex(dots, 40, false), 2);
});

test("keeps the last dot highlighted while the view sits at the bottom", async () => {
  const { railCurrentDotIndex } = await loadSubject();
  const dots = [{ itemIndex: 0 }, { itemIndex: 4 }].map((dot) => ({ ...dot, prompt: "" }));

  // 最后一段内容比视口短时，贴底的视口顶边仍落在上一轮里；当前轮是最后一轮。
  assert.equal(railCurrentDotIndex(dots, 0, true), 1);
  assert.equal(railCurrentDotIndex([], 0, true), -1);
});

test("highlights nothing while the viewport top is above the first prompt", async () => {
  const { railCurrentDotIndex } = await loadSubject();
  const dots = [{ itemIndex: 3, prompt: "提问" }];

  assert.equal(railCurrentDotIndex(dots, 0, false), -1);
  assert.equal(railCurrentDotIndex([], 0, false), -1);
});

test("highlights the first prompt when the first data item is the prompt itself", async () => {
  const { railCurrentDotIndex } = await loadSubject();
  const dots = [{ itemIndex: 0, prompt: "第一问" }, { itemIndex: 4, prompt: "第二问" }];

  // 页首插槽不是条目：视图停在页首时顶部可见条目就是第一条数据项，它自己没有
  // 上方的隐藏提问，所以第一个圆点就是当前轮。
  assert.equal(railCurrentDotIndex(dots, 0, false), 0);
});

test("puts the dots on a 24px pitch", async () => {
  const { RAIL_ROW_PX } = await loadSubject();

  // 行高即命中区高度：24px 是 WCAG 2.5.8 的最小目标，相邻两点不再靠伪元素外扩。
  assert.equal(RAIL_ROW_PX, 24);
});

test("keeps the dot column still when every dot fits", async () => {
  const { railScrollTop, RAIL_MAX_HEIGHT_PX, RAIL_ROW_PX } = await loadSubject();

  assert.equal(railScrollTop(4, 5, RAIL_MAX_HEIGHT_PX), 0);
  // 容器上限必须是节距的整数倍：非整倍数时底边切在行中间，露出的半个圆点看不全也
  // 点不到。168 = 7 * 24，放下 7 个整圆点，第 8 个起整块由内部滚动带走。
  assert.equal(RAIL_MAX_HEIGHT_PX % RAIL_ROW_PX, 0);
  assert.equal(RAIL_MAX_HEIGHT_PX, 7 * RAIL_ROW_PX);
  assert.equal(railScrollTop(0, 7, RAIL_MAX_HEIGHT_PX), 0);
  assert.ok(railScrollTop(7, 8, RAIL_MAX_HEIGHT_PX) > 0);
});

test("centers the current dot once the column has to scroll", async () => {
  const { railScrollTop, RAIL_MAX_HEIGHT_PX } = await loadSubject();

  // 圆心在行高一半处：9 * 24 + 12 = 228，减去半个容器高度 84。
  assert.equal(railScrollTop(9, 20, RAIL_MAX_HEIGHT_PX), 228 - RAIL_MAX_HEIGHT_PX / 2);
});

test("centers against the height the column actually has", async () => {
  const { railScrollTop } = await loadSubject();

  // 上下两条按钮挤占后的容器比 168px 上限矮，滚动位置按实际高度换算。
  assert.equal(railScrollTop(9, 20, 120), 228 - 60);
});

test("clamps the dot column scroll to its content bounds", async () => {
  const { railScrollTop, RAIL_MAX_HEIGHT_PX } = await loadSubject();

  assert.equal(railScrollTop(0, 20, RAIL_MAX_HEIGHT_PX), 0);
  // 20 个圆点占 480px，减去 168px 容器后最多滚 312px。
  assert.equal(railScrollTop(19, 20, RAIL_MAX_HEIGHT_PX), 20 * 24 - RAIL_MAX_HEIGHT_PX);
  assert.equal(railScrollTop(-1, 20, RAIL_MAX_HEIGHT_PX), 0);
  assert.equal(railScrollTop(0, 0, RAIL_MAX_HEIGHT_PX), 0);
});

test("steps to the neighbouring prompts", async () => {
  const { railStepItemIndex } = await loadSubject();
  const dots = [0, 4, 9].map((itemIndex) => ({ itemIndex, prompt: "提问" }));

  assert.equal(railStepItemIndex(dots, 1, 1), 9);
  assert.equal(railStepItemIndex(dots, 1, -1), 0);
});

test("stops stepping at both ends", async () => {
  const { railStepItemIndex } = await loadSubject();
  const dots = [0, 4].map((itemIndex) => ({ itemIndex, prompt: "提问" }));

  assert.equal(railStepItemIndex(dots, 1, 1), null);
  assert.equal(railStepItemIndex(dots, 0, -1), null);
  assert.equal(railStepItemIndex([], 0, 1), null);
  assert.equal(railStepItemIndex([], 0, -1), null);
});

test("offers the first prompt when the viewport sits above every dot", async () => {
  const { railStepItemIndex } = await loadSubject();
  const dots = [3, 7].map((itemIndex) => ({ itemIndex, prompt: "提问" }));

  assert.equal(railStepItemIndex(dots, -1, 1), 3);
  assert.equal(railStepItemIndex(dots, -1, -1), null);
});

test("hides the rail for a single prompt", async () => {
  const { shouldShowTranscriptRail } = await loadSubject();

  assert.equal(shouldShowTranscriptRail(0), false);
  assert.equal(shouldShowTranscriptRail(1), false);
  assert.equal(shouldShowTranscriptRail(2), true);
});

test("reads the topmost visible turn from the rendered items", async () => {
  const { railTopVisibleItemIndex } = await loadSubject();
  const items = [
    { index: 3, offset: 0, size: 120 },
    { index: 4, offset: 120, size: 400 },
    { index: 5, offset: 520, size: 90 },
  ];

  assert.equal(railTopVisibleItemIndex(items, 0), 3);
  assert.equal(railTopVisibleItemIndex(items, 119), 3);
  assert.equal(railTopVisibleItemIndex(items, 120), 4);
  assert.equal(railTopVisibleItemIndex(items, 600), 5);
});

test("falls back to the first rendered turn while the header is visible", async () => {
  const { railTopVisibleItemIndex } = await loadSubject();

  assert.equal(railTopVisibleItemIndex([{ index: 7, offset: 0, size: 200 }], -16), 7);
  assert.equal(railTopVisibleItemIndex([], 0), null);
});
