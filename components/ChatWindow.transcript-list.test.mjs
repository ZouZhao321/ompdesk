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

test("keeps no paging leftovers in the transcript", () => {
  assert.doesNotMatch(source, /chat\.loadEarlier/);
  assert.doesNotMatch(source, /IntersectionObserver/);
  assert.doesNotMatch(source, /chat-lazy-load/);
});
