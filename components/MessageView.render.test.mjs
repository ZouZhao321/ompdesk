import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MessageView } from "./MessageView.tsx";
import { I18nProvider } from "@/hooks/useI18n";

// Server rendering runs the component's real render path (hooks, markdown,
// syntax highlighting) without a DOM, so a thrown error or a vanished message
// shows up here instead of in the browser.
function render(message) {
  return renderToStaticMarkup(createElement(I18nProvider, null, createElement(MessageView, { message })));
}

// Syntax highlighting wraps tokens in <span>s, so assertions about visible
// text run against the markup with tags removed.
function visibleText(html) {
  return html
    .replace(/<[^>]*>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&");
}

const USER_TEXT = "请把这段文字渲染出来";
const ASSISTANT_TEXT = "这是助手的回复内容";
const TOOL_PATH = "/project/src/render-fixture.ts";

test("user message text reaches the rendered markup", () => {
  const html = render({ role: "user", content: USER_TEXT });
  assert.ok(html.includes(USER_TEXT), "user text missing from rendered markup");
});

test("assistant message text reaches the rendered markup", () => {
  const html = render({
    role: "assistant",
    content: [{ type: "text", text: ASSISTANT_TEXT }],
    model: "mock-model",
    provider: "mock",
  });
  assert.ok(html.includes(ASSISTANT_TEXT), "assistant text missing from rendered markup");
});

test("fenced code in an assistant message renders as a code block", () => {
  const html = render({
    role: "assistant",
    content: [{ type: "text", text: "示例：\n\n```ts\nconst answer = 42;\n```\n" }],
    model: "mock-model",
    provider: "mock",
  });
  assert.ok(visibleText(html).includes("const answer = 42"), "code body missing from rendered markup");
  assert.ok(/<pre|<code/.test(html), "no code element was rendered");
});

test("a normalized tool call renders its name and argument", () => {
  const html = render({
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
