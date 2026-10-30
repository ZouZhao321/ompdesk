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
    /const TRANSCRIPT_SLOTS: Components<TranscriptItem, TranscriptSlotsContext> = \{\s*Header: TranscriptHeaderSlot,\s*Footer: TranscriptFooterSlot/,
  );
  assert.match(source, /context=\{\{ header: transcriptHeader, footer: transcriptFooter \}\}/);
  assert.match(source, /<div ref=\{messagesEndRef\} \/>/);
});

test("keeps no paging leftovers in the transcript", () => {
  assert.doesNotMatch(source, /chat\.loadEarlier/);
  assert.doesNotMatch(source, /IntersectionObserver/);
  assert.doesNotMatch(source, /chat-lazy-load/);
});
