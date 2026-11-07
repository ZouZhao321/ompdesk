import test from "node:test";
import assert from "node:assert/strict";

async function loadSubject() {
	return import("./transcript-virtual-list.ts");
}

function turn(key) {
	return { key };
}

test("opens a long transcript on its last turn", async () => {
	const { buildVirtualTranscriptModel } = await loadSubject();
	const items = Array.from({ length: 200 }, (_, index) => turn(`entry-${index}`));

	assert.deepEqual(buildVirtualTranscriptModel(items).initialTopMostItemIndex, {
		index: 199,
		align: "end",
	});
});

test("keeps a transcript that is still empty at the top", async () => {
	const { buildVirtualTranscriptModel } = await loadSubject();
	assert.deepEqual(buildVirtualTranscriptModel([]).initialTopMostItemIndex, {
		index: 0,
		align: "end",
	});
});

test("keys each entry by the anchor of its turn", async () => {
	const { buildVirtualTranscriptModel } = await loadSubject();
	const { itemKeys } = buildVirtualTranscriptModel([turn("entry-a"), turn("entry-b"), turn("entry-c")]);

	assert.deepEqual(itemKeys, ["entry-a", "entry-b", "entry-c"]);
});

test("falls back to the message index when an entry carries no id", async () => {
	const { buildVirtualTranscriptModel } = await loadSubject();
	const { itemKeys } = buildVirtualTranscriptModel([turn("entry-a"), turn(""), turn("")]);

	assert.deepEqual(itemKeys, ["entry-a", "index-1", "index-2"]);
});

test("suffixes repeated keys so the list never sees a duplicate", async () => {
	const { buildVirtualTranscriptModel } = await loadSubject();
	const { itemKeys } = buildVirtualTranscriptModel([turn("entry-a"), turn("entry-a"), turn("entry-a#1")]);

	assert.deepEqual(itemKeys, ["entry-a", "entry-a#1", "entry-a#1#1"]);
});

test("appends the live tail key without touching the turn keys", async () => {
	const { buildVirtualTranscriptModel } = await loadSubject();
	const turns = [turn("entry-a"), turn("entry-b")];

	const model = buildVirtualTranscriptModel(turns, "transcript-live-tail");

	assert.deepEqual(model.itemKeys, ["entry-a", "entry-b", "transcript-live-tail"]);
	assert.deepEqual(model.initialTopMostItemIndex, { index: 2, align: "end" });
});

test("follows the output until the user scrolls away", async () => {
	const { transcriptFollowOutput } = await loadSubject();

	assert.equal(transcriptFollowOutput(false), "auto");
	assert.equal(transcriptFollowOutput(true), false);
});
