import test from "node:test";
import assert from "node:assert/strict";
import { buildVirtualTranscriptModel } from "./transcript-virtual-list.ts";
import {
	hasTranscriptLiveTail,
	TRANSCRIPT_LIVE_TAIL_KEY,
	isTranscriptLiveTailItem,
	withTranscriptLiveTail,
} from "./transcript-live-tail.ts";

function turn(key) {
	return { key };
}

function streamingMessage(text) {
	return { role: "assistant", content: [{ type: "text", text }] };
}

test("appends the streaming message after every turn", () => {
	const streaming = streamingMessage("half an answer");
	const items = withTranscriptLiveTail([turn("entry-a"), turn("entry-b")], streaming);

	assert.equal(items.length, 3);
	assert.deepEqual(items.slice(0, 2), [turn("entry-a"), turn("entry-b")]);
	const tail = items[2];
	assert.equal(isTranscriptLiveTailItem(tail), true);
	assert.equal(tail.key, TRANSCRIPT_LIVE_TAIL_KEY);
	assert.equal(tail.message, streaming);
});

test("leaves the item array untouched while nothing is streaming", () => {
	const items = [turn("entry-a"), turn("entry-b")];

	assert.equal(withTranscriptLiveTail(items, null), items);
});

test("keeps the key table as long as the item list before the first chunk", () => {
	// agent_start 到首个数据块之间：流式已开始，消息还是空的。数据表与键表都只由
	// hasTranscriptLiveTail 决定加不加合成项，长度因此始终一致。
	const turns = [turn("entry-a"), turn("entry-b")];
	const streamState = { isStreaming: true, streamingMessage: null };
	const streamingMessage = streamState.isStreaming ? streamState.streamingMessage : null;
	const items = withTranscriptLiveTail(turns, streamingMessage);
	const model = buildVirtualTranscriptModel(
		turns,
		hasTranscriptLiveTail(streamingMessage) ? TRANSCRIPT_LIVE_TAIL_KEY : null,
	);

	assert.equal(items.length, 2);
	assert.equal(model.itemKeys.length, items.length);
});

test("gives the live tail the last slot in the list model", () => {
	const turns = [turn("entry-a"), turn("entry-b")];
	const items = withTranscriptLiveTail(turns, streamingMessage("half an answer"));
	const model = buildVirtualTranscriptModel(turns, items[items.length - 1].key);

	assert.deepEqual(model.itemKeys, ["entry-a", "entry-b", TRANSCRIPT_LIVE_TAIL_KEY]);
	assert.deepEqual(model.initialTopMostItemIndex, { index: 2, align: "end" });
});

test("keeps one live tail across streaming updates", () => {
	const turns = [turn("entry-a")];
	const before = withTranscriptLiveTail(turns, streamingMessage("a"));
	const after = withTranscriptLiveTail(turns, streamingMessage("ab"));

	assert.equal(after.length, 2);
	assert.equal(after[0], before[0]);
	assert.equal(after[1].key, before[1].key);
	assert.notEqual(after[1], before[1]);
});

test("never collides with a turn key", () => {
	const turns = [turn(TRANSCRIPT_LIVE_TAIL_KEY)];

	assert.deepEqual(buildVirtualTranscriptModel(turns, TRANSCRIPT_LIVE_TAIL_KEY).itemKeys, [
		TRANSCRIPT_LIVE_TAIL_KEY,
		`${TRANSCRIPT_LIVE_TAIL_KEY}#1`,
	]);
});
