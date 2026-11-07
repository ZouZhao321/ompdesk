import test from "node:test";
import assert from "node:assert/strict";

async function loadSubject() {
	return import("./transcript-items.ts");
}

function userMessage(text) {
	return { role: "user", content: text };
}

function assistantMessage(content) {
	return { role: "assistant", content, model: "test-model", provider: "test-provider" };
}

function textBlock(text) {
	return { type: "text", text };
}

function thinkingBlock(thinking) {
	return { type: "thinking", thinking };
}

function toolCallBlock(toolCallId, toolName = "read") {
	return { type: "toolCall", toolCallId, toolName, input: { path: "README.md" } };
}

function toolResultMessage(toolCallId) {
	return {
		role: "toolResult",
		toolCallId,
		toolName: "read",
		content: [{ type: "text", text: "ok" }],
		isError: false,
	};
}

function compactionSummary(text) {
	return { role: "custom", customType: "compaction", content: text, display: false };
}

function skillPromptMessage(text) {
	return {
		role: "custom",
		customType: "skill-prompt",
		attribution: "user",
		content: '<skill name="review" location="/repo/.omp/skills/review/SKILL.md">\nbody\n</skill>',
		display: true,
		details: { name: "review", args: "src/main.ts", prompt: text, lineCount: 1 },
		timestamp: 0,
	};
}

function entryIdsFor(messages) {
	return messages.map((_, index) => `entry-${index}`);
}

function build(messages, options = {}) {
	return loadSubject().then(({ buildTranscriptItems }) =>
		buildTranscriptItems(messages, entryIdsFor(messages), options),
	);
}

test("groups a single question into one turn", async () => {
	const messages = [
		userMessage("fix the bug"),
		assistantMessage([toolCallBlock("call-1")]),
		assistantMessage([textBlock("fixed")]),
	];

	const items = await build(messages);

	assert.equal(items.length, 1);
	const [turn] = items;
	assert.equal(turn.key, "entry-0");
	assert.equal(turn.isAnchor, true);
	assert.equal(turn.isStandalone, false);
	assert.deepEqual(turn.messageIndices, []);
	assert.equal(turn.anchorIndex, 0);
	assert.deepEqual(turn.visibleProcessIndices, [1]);
	assert.equal(turn.finalAssistantIndex, 2);
	assert.equal(turn.finalProcessMessage, null);
	assert.equal(turn.finalAnswerMessage.content.length, 1);
	assert.equal(turn.processMessageCount, 1);
	assert.equal(turn.toolCallCount, 1);
	assert.deepEqual(turn.tailIndices, []);
	assert.equal(turn.isLiveTail, false);
});

test("keeps shell executions inside the folded process range", async () => {
	const messages = [
		userMessage("run the tests"),
		{ role: "bashExecution", command: "bun test", output: "all green" },
		assistantMessage([textBlock("看了测试输出")]),
	];

	const items = await build(messages);

	assert.equal(items.length, 1);
	const [turn] = items;
	// shell 执行是过程区间里的一条可见消息：折叠过程组时它与输出都还在。
	assert.deepEqual(turn.visibleProcessIndices, [1]);
	assert.equal(turn.processMessageCount, 1);
	assert.equal(turn.finalAssistantIndex, 2);
});

test("keeps a turn without any assistant reply as individual messages", async () => {
	const messages = [userMessage("look at this"), toolResultMessage("call-1")];

	const items = await build(messages);

	assert.equal(items.length, 1);
	const [turn] = items;
	assert.equal(turn.isAnchor, true);
	assert.equal(turn.isStandalone, true);
	assert.equal(turn.finalAssistantIndex, -1);
	assert.equal(turn.finalAnswerMessage, null);
	assert.equal(turn.processMessageCount, 0);
	assert.deepEqual(turn.tailIndices, []);
	assert.deepEqual(turn.messageIndices, [0, 1]);
});

test("fills process counts on a turn without any assistant reply", async () => {
	const messages = [userMessage("run the tests"), { role: "bashExecution", command: "bun test", output: "all green" }];

	const items = await build(messages);

	const [turn] = items;
	// 逐条渲染的那一轮也要按同一口径填写过程计数：消费者不必区分渲染方式。
	assert.equal(turn.isStandalone, true);
	assert.equal(turn.visibleProcessIndices.length, 1);
	assert.equal(turn.processMessageCount, 1);
	assert.equal(turn.toolCallCount, 0);
	assert.equal(turn.hasProcessError, false);
});

test("keeps a reply that carries no answer text as a process-only turn", async () => {
	const messages = [
		userMessage("run the tests"),
		assistantMessage([toolCallBlock("call-1")]),
		assistantMessage([toolCallBlock("call-2")]),
	];

	const items = await build(messages);

	const [turn] = items;
	assert.equal(turn.finalAssistantIndex, 2);
	assert.equal(turn.finalAnswerMessage, null);
	// 工具调用块留在正式回答的过程块里，过程组里再加一条
	assert.equal(turn.finalProcessMessage.content.length, 1);
	assert.equal(turn.processMessageCount, 2);
	assert.equal(turn.toolCallCount, 2);
});

test("treats a compaction summary as an anchor", async () => {
	const messages = [
		userMessage("first question"),
		assistantMessage([textBlock("first answer")]),
		compactionSummary("compacted history"),
		assistantMessage([toolCallBlock("call-1")]),
		assistantMessage([textBlock("post-compaction answer")]),
	];

	const items = await build(messages);

	assert.equal(items.length, 2);
	assert.equal(items[0].anchorIndex, 0);
	assert.equal(items[0].finalAssistantIndex, 1);

	const [postCompaction] = items.slice(1);
	assert.equal(postCompaction.isAnchor, true);
	assert.equal(postCompaction.key, "entry-2");
	assert.equal(postCompaction.anchorIndex, 2);
	assert.equal(postCompaction.finalAssistantIndex, 4);
	assert.deepEqual(postCompaction.visibleProcessIndices, [3]);
	assert.equal(postCompaction.isStandalone, false);
	assert.equal(postCompaction.finalAnswerMessage.content[0].text, "post-compaction answer");
});

test("folds process group away when no process message is displayable", async () => {
	const messages = [
		userMessage("what time is it"),
		assistantMessage([thinkingBlock("")]),
		assistantMessage([textBlock("noon")]),
	];

	const items = await build(messages);

	const [turn] = items;
	// 过程消息仍在这一轮里，只是没有任何一条能显示出来
	assert.equal(turn.isStandalone, false);
	assert.deepEqual(turn.visibleProcessIndices, []);
	assert.equal(turn.finalProcessMessage, null);
	assert.equal(turn.processMessageCount, 0);
	assert.equal(turn.toolCallCount, 0);
	assert.equal(turn.finalAnswerMessage.content[0].text, "noon");
});

test("keeps a provider error that sits mid-turn inside the process group", async () => {
	const messages = [
		userMessage("run the tests"),
		assistantMessage([toolCallBlock("call-1")]),
		toolResultMessage("call-1"),
		// 内容块为空、只有 provider 错误：MessageView 仍会渲染错误横幅。
		{ ...assistantMessage([]), stopReason: "error", errorMessage: "429 rate limited" },
		assistantMessage([textBlock("tests passed")]),
	];

	const items = await build(messages);

	const [turn] = items;
	assert.equal(turn.isStandalone, false);
	assert.equal(turn.finalAssistantIndex, 4);
	// 这条既不是过程项也不是正式回答的话，整条消息会从界面消失。
	assert.deepEqual(turn.visibleProcessIndices, [1, 3]);
	assert.equal(turn.processMessageCount, 2);
	assert.equal(turn.finalAnswerMessage.content[0].text, "tests passed");
});

test("flags a process group that carries a provider error", async () => {
	const messages = [
		userMessage("run the tests"),
		// 内容块为空、只有 provider 错误：界面靠这个标记把过程组默认展开。
		{ ...assistantMessage([]), stopReason: "error", errorMessage: "429 rate limited" },
		assistantMessage([textBlock("tests passed")]),
	];

	const [turn] = await build(messages);
	assert.equal(turn.hasProcessError, true);
	assert.equal(turn.isLastTurn, true);

	// 没有错误的一轮照旧默认折叠，不因为这条标记全体展开。
	const clean = await build([
		userMessage("what time is it"),
		assistantMessage([toolCallBlock("call-1")]),
		assistantMessage([textBlock("noon")]),
	]);
	assert.equal(clean[0].hasProcessError, false);
	assert.equal(clean[0].isLastTurn, true);
});

test("marks only the last turn, so a historical provider error stays folded", async () => {
	const messages = [
		userMessage("run the tests"),
		{ ...assistantMessage([]), stopReason: "error", errorMessage: "429 rate limited" },
		assistantMessage([textBlock("tests passed after a retry")]),
		userMessage("run them again"),
		{ ...assistantMessage([]), stopReason: "error", errorMessage: "500 upstream" },
		assistantMessage([textBlock("second run passed")]),
	];

	const items = await build(messages);

	assert.equal(items.length, 2);
	// 两条都带着错误：首屏只有最新一轮的那一组该撑开，历史轮回到折叠。
	assert.equal(items[0].hasProcessError, true);
	assert.equal(items[0].isLastTurn, false);
	assert.equal(items[1].hasProcessError, true);
	assert.equal(items[1].isLastTurn, true);
});

test("does not group the last turn while the agent is running", async () => {
	const messages = [
		userMessage("first"),
		assistantMessage([textBlock("first answer")]),
		userMessage("second"),
		assistantMessage([toolCallBlock("call-1")]),
		assistantMessage([textBlock("second answer")]),
	];

	const items = await build(messages, { busy: true });

	assert.equal(items.length, 2);
	assert.equal(items[0].isStandalone, false);
	assert.equal(items[0].isLiveTail, false);

	const liveTail = items[1];
	assert.equal(liveTail.isLiveTail, true);
	assert.equal(liveTail.isStandalone, true);
	assert.deepEqual(liveTail.messageIndices, [2, 3, 4]);
	// 判定结果仍然记录这一轮的正式回答，只是界面不折叠
	assert.equal(liveTail.finalAssistantIndex, 4);
});

test("does not group the last turn while streaming even when idle", async () => {
	const messages = [userMessage("hi"), assistantMessage([textBlock("hello")])];

	const streaming = await build(messages, { isStreaming: true });
	assert.equal(streaming[0].isLiveTail, true);
	assert.equal(streaming[0].isStandalone, true);

	const settled = await build(messages);
	assert.equal(settled[0].isLiveTail, false);
	assert.equal(settled[0].isStandalone, false);
});

test("attributes trailing messages to the turn they follow", async () => {
	const messages = [
		userMessage("first"),
		assistantMessage([textBlock("first answer")]),
		{ role: "custom", customType: "notification", content: "background note", display: true },
		userMessage("second"),
		assistantMessage([textBlock("second answer")]),
	];

	const items = await build(messages);

	assert.equal(items.length, 2);
	assert.equal(items[0].anchorIndex, 0);
	assert.equal(items[0].finalAssistantIndex, 1);
	assert.deepEqual(items[0].tailIndices, [2]);
	assert.equal(items[1].anchorIndex, 3);
});

test("renders messages before the first anchor as individual items", async () => {
	const messages = [toolResultMessage("call-1"), userMessage("question"), assistantMessage([textBlock("answer")])];

	const items = await build(messages);

	assert.equal(items.length, 2);
	assert.equal(items[0].isAnchor, false);
	assert.equal(items[0].key, "entry-0");
	assert.equal(items[0].isStandalone, true);
	assert.deepEqual(items[0].messageIndices, [0]);
	assert.equal(items[1].isAnchor, true);
	assert.equal(items[1].isStandalone, false);
});

test("collects the files a turn wrote", async () => {
	const messages = [
		userMessage("patch the readme"),
		assistantMessage([
			{
				type: "toolCall",
				toolCallId: "write-1",
				toolName: "write",
				input: { file_path: "README.md", content: "hi" },
			},
		]),
		assistantMessage([textBlock("patched")]),
	];
	const toolResults = new Map([
		["write-1", { role: "toolResult", toolCallId: "write-1", toolName: "write", content: [], isError: false }],
	]);

	const items = await build(messages, { toolResults, cwd: "/work" });

	assert.deepEqual(items[0].writtenFiles, [{ filePath: "/work/README.md" }]);
});

test("an autoloaded skill message stays inside the process group", async () => {
	const messages = [
		{ role: "user", content: "普通提问" },
		{
			role: "custom",
			customType: "skill-prompt",
			attribution: "agent",
			content: "自动加载的技能正文",
			display: false,
			details: { name: "typescript", path: "/repo/.omp/skills/typescript/SKILL.md" },
			timestamp: 0,
		},
		assistantMessage([textBlock("回答")]),
	];

	const items = await build(messages);

	assert.equal(items.length, 1);
	const [turn] = items;
	assert.equal(turn.anchorIndex, 0);
	assert.deepEqual(turn.visibleProcessIndices, [1]);
});

test("a skill prompt anchors its own turn instead of joining the process group", async () => {
	const messages = [
		skillPromptMessage("/skill:review src/main.ts"),
		assistantMessage([toolCallBlock("call-1")]),
		assistantMessage([textBlock("reviewed")]),
	];

	const items = await build(messages);

	assert.equal(items.length, 1);
	const [turn] = items;
	assert.equal(turn.anchorIndex, 0);
	assert.equal(turn.isAnchor, true);
	assert.equal(turn.isStandalone, false);
	assert.deepEqual(turn.visibleProcessIndices, [1]);
	assert.equal(turn.finalAssistantIndex, 2);
});
