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
  const { buildTranscriptRailDots, RAIL_PROMPT_CHARS } = await loadSubject();
  const long = "提问".repeat(RAIL_PROMPT_CHARS);

  const [dot] = buildTranscriptRailDots([item(0, true)], prompts({ 0: long }));

  assert.equal(Array.from(dot.prompt).length, RAIL_PROMPT_CHARS);
});

test("highlights the dot of the turn the viewport top sits in", async () => {
  const { railCurrentDotIndex } = await loadSubject();
  const dots = [{ itemIndex: 0 }, { itemIndex: 4 }, { itemIndex: 9 }].map((dot) => ({ ...dot, prompt: "" }));

  assert.equal(railCurrentDotIndex(dots, 0), 0);
  assert.equal(railCurrentDotIndex(dots, 6), 1);
  assert.equal(railCurrentDotIndex(dots, 9), 2);
  assert.equal(railCurrentDotIndex(dots, 40), 2);
});

test("highlights nothing while the viewport top is above the first prompt", async () => {
  const { railCurrentDotIndex } = await loadSubject();
  const dots = [{ itemIndex: 3, prompt: "提问" }];

  assert.equal(railCurrentDotIndex(dots, 0), -1);
  assert.equal(railCurrentDotIndex([], 0), -1);
});

test("highlights the first prompt when the first data item is the prompt itself", async () => {
  const { railCurrentDotIndex } = await loadSubject();
  const dots = [{ itemIndex: 0, prompt: "第一问" }, { itemIndex: 4, prompt: "第二问" }];

  // 页首插槽不是条目：视图停在页首时顶部可见条目就是第一条数据项，它自己没有
  // 上方的隐藏提问，所以第一个圆点就是当前轮。
  assert.equal(railCurrentDotIndex(dots, 0), 0);
});

test("puts the dots on a 14px pitch", async () => {
  const { RAIL_ROW_PX } = await loadSubject();

  assert.equal(RAIL_ROW_PX, 14);
});

test("keeps the dot column still when every dot fits", async () => {
  const { railScrollTop, RAIL_ROW_PX } = await loadSubject();

  assert.equal(railScrollTop(4, 5, 180), 0);
  // 12 个圆点按 14px 节距占 168px，仍在 180px 容器内
  assert.equal(railScrollTop(0, 12, 180), 0);
  assert.equal(railScrollTop(0, Math.floor(180 / RAIL_ROW_PX), 180), 0);
});

test("centers the current dot once the column has to scroll", async () => {
  const { railScrollTop } = await loadSubject();

  // 圆心在行高一半处：9 * 14 + 7 = 133，减去半个容器高度 90。
  assert.equal(railScrollTop(9, 20, 180), 43);
});

test("centers against the height the column actually has", async () => {
  const { railScrollTop } = await loadSubject();

  // 上下两条按钮挤占后的容器比 180px 上限矮，滚动位置按实际高度换算。
  assert.equal(railScrollTop(9, 20, 120), 133 - 60);
});

test("clamps the dot column scroll to its content bounds", async () => {
  const { railScrollTop } = await loadSubject();

  assert.equal(railScrollTop(0, 20, 180), 0);
  assert.equal(railScrollTop(19, 20, 180), 100);
  assert.equal(railScrollTop(-1, 20, 180), 0);
  assert.equal(railScrollTop(0, 0, 180), 0);
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

test("keeps the rail clear of the transcript until the whole lane fits", async () => {
  const {
    placeTranscriptRail,
    RAIL_COLUMN_GAP_PX,
    RAIL_COLUMN_PADDING_PX,
    RAIL_COLUMN_WIDTH_PX,
    RAIL_EDGE_MARGIN_PX,
    RAIL_INSET_PX,
    RAIL_MIN_REGION_PX,
    RAIL_WIDTH_PX,
  } = await loadSubject();

  // 阈值把内边距与缝隙一起算进去：版心 820 + 内边距 32 + 缝隙 6 + 车道 36 + 留白 8。
  assert.equal(RAIL_MIN_REGION_PX, 944);
  // 差一点点就放不下的转写区一律收起，不许把跳转条钉在最右侧压到正文。
  for (const regionWidth of [868, 900, 943]) {
    assert.equal(placeTranscriptRail(regionWidth).visible, false, `${regionWidth}px 放不下整条车道`);
  }

  const tight = placeTranscriptRail(944);
  assert.equal(tight.visible, true);
  // 跳转条左缘落在中线 +432，与正文右缘之间还留着那条 6px 缝隙。
  assert.equal(tight.left, RAIL_INSET_PX);
  assert.equal(tight.left, 432);
  assert.ok(tight.left - RAIL_COLUMN_WIDTH_PX / 2 >= RAIL_COLUMN_GAP_PX);
  assert.equal(tight.left - (RAIL_COLUMN_WIDTH_PX / 2 + RAIL_COLUMN_PADDING_PX), RAIL_COLUMN_GAP_PX);
  // 右缘正好用上最小留白：再窄一点就不该再画。
  assert.equal(944 / 2 - tight.right, RAIL_EDGE_MARGIN_PX);
  assert.equal(tight.right - tight.left, RAIL_WIDTH_PX);

  const wide = placeTranscriptRail(1356);
  assert.equal(wide.visible, true);
  assert.equal(wide.left, 432);
  assert.equal(wide.right - wide.left, RAIL_WIDTH_PX);
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
