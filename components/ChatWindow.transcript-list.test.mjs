import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("hands the scroll element over to the virtual list", () => {
  assert.match(source, /scrollerRef=\{handleTranscriptScrollerRef\}/);
  assert.match(source, /scrollContainerRef\.current = element instanceof HTMLDivElement \? element : null/);
  assert.match(source, /initialTopMostItemIndex=\{virtualTranscript\.initialTopMostItemIndex\}/);
});

test("renders the parts outside the list through its header and footer slots", () => {
  assert.match(
    source,
    /const TRANSCRIPT_SLOTS: Components<TranscriptListItem, TranscriptSlotsContext> = \{\s*Header: TranscriptHeaderSlot,\s*Footer: TranscriptFooterSlot/,
  );
  assert.match(source, /context=\{\{ header: transcriptHeader, footer: transcriptFooter \}\}/);
  // 没有第二个滚动锚点：滚动位置只归列表管。
  assert.doesNotMatch(source, /messagesEndRef/);
});

test("parks the streaming message as the last list item", () => {
  assert.match(
    source,
    /withTranscriptLiveTail\(\s*groupedTranscriptItems,\s*streamState\.isStreaming \? streamState\.streamingMessage : null/,
  );
  assert.match(source, /itemContent=\{renderTranscriptRow\}/);
  // 行组件按项记忆，流式数据块只重绘末尾这一项。
  assert.match(source, /const TranscriptRow = memo\(function TranscriptRow\(/);
  // 页尾不再渲染流式气泡，它已经是列表最后一项。
  const footerSource = source.slice(source.indexOf("const transcriptFooter = ("), source.indexOf("if (loading) {"));
  assert.doesNotMatch(footerSource, /streamingMessage as AgentMessage/);
});

test("hands follow and the jump to the list", () => {
  assert.match(source, /followOutput=\{transcriptFollowOutput\(autoFollowPaused\)\}/);
  assert.match(source, /ref=\{virtuosoRef\}/);
  assert.match(source, /virtuosoRef\.current\?\.scrollToIndex\(\{\s*index: "LAST",\s*align: "end",/);
  assert.match(source, /scrollTranscriptToEnd,$/m);
});

test("parks the streaming bubble in the same bucket as the finished turn", () => {
  // 流式合成项没有 entryId，锚点取当前最后一轮的键：流结束定稿的是同一轮，
  // 展开状态因此不会随工具调用变化、也不会在流结束时丢。
  assert.match(source, /turnAnchorEntryId=\{row\.liveTailAnchorEntryId\}/);
  assert.match(source, /sessionId=\{row\.sessionId\}/);
  assert.match(source, /groupedTranscriptItems\[groupedTranscriptItems\.length - 1\]\?\.key/);
});

test("clears a rail jump once, whether or not the list scrolled", () => {
  // 只对齐一次与兜底清算的时序在 lib/transcript-rail-jump.ts，由它的逻辑测试覆盖；
  // 这里只钉住接线：列表停稳与兜底定时器都走同一个收尾，跳转自己先停掉跟随。
  assert.match(
    source,
    /const handleRailJump = useCallback\(\(itemIndex: number\) => \{[\s\S]*?pauseAutoFollow\(\);[\s\S]*?railJumpRef\.current = \{ pending: itemIndex \};/,
  );
  assert.match(source, /railJumpTimerRef\.current = window\.setTimeout\(settleRailJumpNow, RAIL_JUMP_SETTLE_MS\)/);
  assert.match(
    source,
    /const handleTranscriptScrollingChange = useCallback\(\(scrolling: boolean\) => \{\s*if \(scrolling\) return;\s*settleRailJumpNow\(\);/,
  );
});

test("skips the rail measurement while the rail is hidden", () => {
  // 单轮、移动档、窄转写区都不显示跳转条：可见性由跳转条自己量，不可见时不读尺寸、
  // 滚动帧里也不写状态。
  assert.match(source, /const syncRailTopItem = useCallback\(\(\) => \{\s*if \(!railVisibleRef\.current\) return;/);
  assert.match(source, /onVisibilityChange=\{handleRailVisibilityChange\}/);
});

test("keeps no paging leftovers in the transcript", () => {
  assert.doesNotMatch(source, /chat\.loadEarlier/);
  assert.doesNotMatch(source, /IntersectionObserver/);
  assert.doesNotMatch(source, /chat-lazy-load/);
});
