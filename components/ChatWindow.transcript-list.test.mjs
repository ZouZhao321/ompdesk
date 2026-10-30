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
  // 数据表与键表共用同一条判据：流式已开始但消息还空时两表都不加合成项。
  assert.match(source, /withTranscriptLiveTail\(groupedTranscriptItems, streamingTranscriptMessage\)/);
  assert.match(source, /const transcriptLiveTailKey = hasTranscriptLiveTail\(streamingTranscriptMessage\)/);
  assert.match(source, /itemContent=\{renderTranscriptRow\}/);
  // 行组件按项记忆，流式数据块只重绘末尾这一项。
  assert.match(source, /const TranscriptRow = memo\(function TranscriptRow\(/);
  // 页尾不再渲染流式气泡，它已经是列表最后一项。
  const footerSource = source.slice(source.indexOf("const transcriptFooter = ("), source.indexOf("if (loading) {"));
  // 锚点一旦找不到切片就是空串，下面的否定断言会静默通过。
  assert.ok(footerSource.length > 0, "the transcript footer slice is empty");
  assert.doesNotMatch(footerSource, /streamingMessage as AgentMessage/);
});

test("hands follow and the jump to the list", () => {
  assert.match(source, /followOutput=\{transcriptFollowOutput\(autoFollowPaused\)\}/);
  // 列表的贴底阈值与 hook 判定共用一个常量，两边对「还在底部」不会给出不同答案。
  assert.match(source, /atBottomThreshold=\{FOLLOW_BOTTOM_THRESHOLD_PX\}/);
  assert.match(source, /import \{ FOLLOW_BOTTOM_THRESHOLD_PX \} from "@\/lib\/transcript-follow"/);
  assert.match(source, /ref=\{virtuosoRef\}/);
  assert.match(source, /list\.scrollToIndex\(\{ index: "LAST", align: "end", behavior: resolved \}\)/);
  assert.match(source, /scrollTranscriptToEnd,$/m);
});

test("lands the transcript on the real bottom after aligning the last item", () => {
  // 「对齐到末端」只把最后一条数据项的底边对上视口底，页脚插槽在它之后；定位后
  // 再补一次滚动元素自身的底部滚动，页脚晚一帧出现也能算进去。
  const target = source.slice(source.indexOf("const scrollTranscriptToEnd = useCallback("), source.indexOf("const {", source.indexOf("const scrollTranscriptToEnd = useCallback(")));
  // 空切片会让下面的断言失去对象，先确认切到了东西。
  assert.ok(target.length > 0, "the scrollTranscriptToEnd slice is empty");
  assert.match(target, /requestAnimationFrame\(\(\) => \{\s*virtuosoRef\.current\?\.scrollTo\(\{ top: Number\.MAX_SAFE_INTEGER, behavior: resolved \}\);/);
  // 首屏同样补一次：会话加载完成后落到底部，不差页脚那一截。
  assert.match(source, /initialBottomLandedRef[\s\S]*?scrollTranscriptToEnd\("auto"\)/);
});

test("draws the conversation column from the rail geometry constants", () => {
  // 行盒宽度与内边距只有一组导出常量，ChatWindow 不再手抄 820 / 16。
  assert.match(source, /RAIL_COLUMN_PADDING_PX,\s*RAIL_COLUMN_WIDTH_PX,/);
  assert.match(source, /const CHAT_COLUMN_PADDING = RAIL_COLUMN_PADDING_PX;/);
  assert.match(source, /maxWidth: RAIL_COLUMN_WIDTH_PX \+ CHAT_COLUMN_PADDING \* 2,/);
  assert.doesNotMatch(source, /maxWidth: 820\b/);
  // 空会话的占位块用同一个版心，外层 px-4 已经是那 16px 内边距，这里不再加一份。
  assert.match(source, /<div className="w-full" style=\{\{ maxWidth: RAIL_COLUMN_WIDTH_PX \}\}>/);
  assert.doesNotMatch(source, /max-w-\[820px\]/);
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
    /const handleTranscriptScrollingChange = useCallback\(\(scrolling: boolean\) => \{\s*if \(scrolling\) return;\s*setTranscriptAtBottom\(transcriptAtBottomRef\.current\);\s*settleRailJumpNow\(\);/,
  );
  // 落点那串滚动不参与跟随判定：跳转开始时合上一次性抑制器。
  assert.match(
    source,
    /pauseAutoFollow\(\);[\s\S]*?holdFollowObservation\(\);[\s\S]*?railJumpRef\.current = \{ pending: itemIndex \};/,
  );
  // 落点停下（重定位也做完）才松开；重定位之后抑制器继续合着，由兜底定时器兜底。
  assert.match(
    source,
    /if \(settled\.realign === null\) \{[\s\S]*?releaseFollowObservation\(\);[\s\S]*?railJumpTimerRef\.current = window\.setTimeout\(\(\) => settleRailJumpNowRef\.current\(\), RAIL_JUMP_SETTLE_MS\)/,
  );
});

test("offers a jump-to-bottom entry whenever the list is not at the bottom", () => {
  // 按钮的第二个来源：列表报告自己不在底部。跟随开着但列表没跟上时也要能点回来。
  assert.match(source, /atBottomStateChange=\{handleTranscriptAtBottomChange\}/);
  assert.match(source, /\(autoFollowPaused \|\| !transcriptAtBottom\) && \(/);
  // 位置只在列表停稳后落成状态，跟随途中的程序化滚动不会让按钮闪一下又消失。
  assert.match(source, /setTranscriptAtBottom\(transcriptAtBottomRef\.current\)/);
  // 换会话就是换一份列表：新列表从末尾挂载，位置跟着复位。
  assert.match(source, /transcriptAtBottomRef\.current = true;\s*setTranscriptAtBottom\(true\);\s*\}, \[activeSessionId\]\);/);
});

test("skips the rail measurement while the rail is hidden", () => {
  // 单轮、移动档、窄转写区都不显示跳转条：可见性由跳转条自己量，不可见时不读尺寸、
  // 滚动帧里也不写状态。
  assert.match(source, /const syncRailTopItem = useCallback\(\(\) => \{\s*if \(!railVisibleRef\.current\) return;/);
  assert.match(source, /onVisibilityChange=\{handleRailVisibilityChange\}/);
});

test("rebuilds the item keys only when the grouping changes", () => {
  // 流式数据块只换末尾合成项的正文，键不变：键与首屏定位只由分组结果算，流式期间
  // itemKeys 与 computeItemKey 保持同一份引用。
  assert.match(
    source,
    /const virtualTranscript = useMemo\(\s*\(\) => buildVirtualTranscriptModel\(groupedTranscriptItems, transcriptLiveTailKey\),\s*\[groupedTranscriptItems, transcriptLiveTailKey\],\s*\);/,
  );
  assert.match(
    source,
    /const computeTranscriptItemKey = useCallback\(\s*\(index: number\) => virtualTranscript\.itemKeys\[index\],\s*\[virtualTranscript\],\s*\)/,
  );
  assert.doesNotMatch(source, /buildVirtualTranscriptModel\(transcriptItems\)/);
});

test("keeps no paging leftovers in the transcript", () => {
  assert.doesNotMatch(source, /chat\.loadEarlier/);
  assert.doesNotMatch(source, /IntersectionObserver/);
  assert.doesNotMatch(source, /chat-lazy-load/);
});
