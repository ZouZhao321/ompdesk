import assert from "node:assert/strict";
import test from "node:test";

import { renderMessage, visibleText } from "../lib/testing/render-harness.mjs";

const USER_TEXT = "请把这段文字渲染出来";
const ASSISTANT_TEXT = "这是助手的回复内容";
const TOOL_PATH = "/project/src/render-fixture.ts";

test("user message text reaches the rendered markup", () => {
	const html = renderMessage({ role: "user", content: USER_TEXT });
	assert.ok(html.includes(USER_TEXT), "user text missing from rendered markup");
});

test("assistant message text reaches the rendered markup", () => {
	const html = renderMessage({
		role: "assistant",
		content: [{ type: "text", text: ASSISTANT_TEXT }],
		model: "mock-model",
		provider: "mock",
	});
	assert.ok(html.includes(ASSISTANT_TEXT), "assistant text missing from rendered markup");
});

test("fenced code in an assistant message renders as a code block", () => {
	const html = renderMessage({
		role: "assistant",
		content: [{ type: "text", text: "示例：\n\n```ts\nconst answer = 42;\n```\n" }],
		model: "mock-model",
		provider: "mock",
	});
	assert.ok(visibleText(html).includes("const answer = 42"), "code body missing from rendered markup");
	assert.ok(/<pre|<code/.test(html), "no code element was rendered");
});

test("a normalized tool call renders its name and argument", () => {
	const html = renderMessage({
		role: "assistant",
		content: [{ type: "toolCall", toolCallId: "call-1", toolName: "read", input: { path: TOOL_PATH } }],
		model: "mock-model",
		provider: "mock",
	});
	assert.ok(visibleText(html).includes(TOOL_PATH), "tool call argument missing from rendered markup");
	assert.ok(visibleText(html).toLowerCase().includes("read"), "tool name missing from rendered markup");
});

// 工具结果不是独立消息：MessageView 对 role="toolResult" 返回 null，结果正文只通过
// toolResults 映射到对应 toolCallId 的 toolCall 下方，因此这里通过第二个参数传入。
test("tool result body reaches the rendered markup through its tool call", () => {
	const body = "render-fixture 工具结果正文：磁盘剩余 42 GB";
	const html = renderMessage(
		{
			role: "assistant",
			model: "mock-model",
			provider: "mock",
			content: [
				{
					type: "toolCall",
					toolCallId: "call-result-1",
					toolName: "bash",
					input: { command: "df -h /project" },
				},
			],
		},
		{
			toolResults: new Map([
				[
					"call-result-1",
					{
						role: "toolResult",
						toolCallId: "call-result-1",
						toolName: "bash",
						content: [{ type: "text", text: body }],
					},
				],
			]),
		},
	);
	assert.ok(visibleText(html).includes(body), "tool result body missing from visible text");
});

test("thinking block body reaches the rendered markup", () => {
	const body = "思考正文：先确认工具结果，再输出最终答复";
	const html = renderMessage({
		role: "assistant",
		content: [{ type: "thinking", thinking: body }],
		model: "mock-model",
		provider: "mock",
	});
	assert.ok(visibleText(html).includes(body), "thinking body missing from visible text");
});

test("compaction summary body reaches the rendered markup", () => {
	const body = "压缩摘要正文：保留最近两轮对话与已修改的文件清单";
	const html = renderMessage({
		role: "custom",
		customType: "compaction",
		display: true,
		content: body,
	});
	assert.ok(visibleText(html).includes(body), "compaction summary body missing from visible text");
});

test("assistant error message reaches the rendered markup", () => {
	const body = "provider 返回 403：当前令牌无权访问该模型";
	const html = renderMessage({
		role: "assistant",
		content: [],
		model: "mock-model",
		provider: "mock",
		stopReason: "error",
		errorMessage: body,
	});
	assert.ok(visibleText(html).includes(body), "error message missing from visible text");
});
