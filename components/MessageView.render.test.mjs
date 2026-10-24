import assert from "node:assert/strict";
import test from "node:test";

import { renderMessage, visibleText } from "../lib/testing/mock-session-harness.mjs";

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
    content: [
      { type: "toolCall", toolCallId: "call-1", toolName: "read", input: { path: TOOL_PATH } },
    ],
    model: "mock-model",
    provider: "mock",
  });
  assert.ok(visibleText(html).includes(TOOL_PATH), "tool call argument missing from rendered markup");
  assert.ok(visibleText(html).toLowerCase().includes("read"), "tool name missing from rendered markup");
});
