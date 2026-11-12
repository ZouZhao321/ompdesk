import assert from "node:assert/strict";
import test from "node:test";

import { renderMessage, visibleText } from "../lib/testing/render-harness.mjs";

const PATCH = [
  "--- a/src/first.ts",
  "+++ b/src/first.ts",
  "@@ -1,2 +1,2 @@",
  "-const first = 1;",
  "+const first = 2;",
  " const unchanged = true;",
  "--- a/src/second.ts",
  "+++ b/src/second.ts",
  "@@ -1 +1 @@",
  "-export const second = 1;",
  "+export const second = 2;",
].join("\n");

const UNPARSED_DIFF = "文件差异：first.ts 第 1 行由 1 改成 2";

function assistantWithResult(result) {
  return renderMessage(
    {
      role: "assistant",
      model: "mock-model",
      provider: "mock",
      content: [{ type: "toolCall", toolCallId: "call-diff", toolName: "edit", input: { path: "src/first.ts" } }],
    },
    { toolResults: new Map([["call-diff", result]]) },
  );
}

function toolResult(overrides) {
  return {
    role: "toolResult",
    toolCallId: "call-diff",
    toolName: "edit",
    content: [{ type: "text", text: "applied" }],
    ...overrides,
  };
}

test("renders a two-file unified patch as side-by-side diff rows", () => {
  const html = assistantWithResult(toolResult({ details: { patch: PATCH } }));
  const text = visibleText(html);

  assert.ok(text.includes("src/first.ts"), "first file header missing");
  assert.ok(text.includes("src/second.ts"), "second file header missing");
  assert.ok(text.includes("const first = 2;"), "added line missing");
  assert.ok(text.includes("const first = 1;"), "removed line missing");
});

test("renders an unparsed diff as a numbered patch text view", () => {
  const text = visibleText(assistantWithResult(toolResult({ details: { diff: UNPARSED_DIFF } })));
  assert.ok(text.includes(UNPARSED_DIFF), "diff text missing");
});

test("renders compaction file metadata for read and modified files", () => {
  const summary = [
    "会话已压缩。",
    "",
    "<modified-files>",
    "src/modified-a.ts",
    "src/modified-b.ts",
    "</modified-files>",
    "",
    "<read-files>",
    "src/read-a.ts",
    "</read-files>",
  ].join("\n");

  const text = visibleText(
    renderMessage({ role: "custom", customType: "compaction", display: true, content: summary }),
  );
  assert.ok(text.includes("src/modified-a.ts"), "modified file missing");
  assert.ok(text.includes("src/read-a.ts"), "read file missing");
  assert.ok(text.includes("2 modified"), "modified count missing");
});

test("renders a generic custom message with its title, body and details", () => {
  const html = renderMessage({
    role: "custom",
    customType: "extension-note",
    display: true,
    content: "扩展消息正文",
    details: { nested: { value: 1 } },
  });
  const text = visibleText(html);

  assert.ok(text.includes("扩展消息正文"), "custom body missing");
  assert.ok(text.includes("extension-note"), "custom title missing");
  assert.ok(html.includes("message-action-button"), "message actions missing");
});

test("renders a hidden custom message as a collapsed preview", () => {
  const text = visibleText(
    renderMessage({
      role: "custom",
      customType: "extension-note",
      display: false,
      content: "被隐藏的扩展消息正文足够长以便显示预览",
    }),
  );

  assert.ok(text.includes("被隐藏的扩展消息正文"), "preview text missing");
});

test("renders a user skill prompt with its command label", () => {
  const text = visibleText(
    renderMessage({
      role: "custom",
      customType: "skill-prompt",
      attribution: "user",
      display: true,
      content: "skill 正文",
      details: { prompt: "/skill:review 请检查", name: "review" },
    }),
  );

  assert.ok(text.includes("/skill:review 请检查"), "command label missing");
});

test("renders a bash execution message with its command and output", () => {
  const text = visibleText(
    renderMessage({
      role: "bashExecution",
      command: "echo hello",
      output: "hello",
      exitCode: 0,
    }),
  );

  assert.ok(text.includes("echo hello"), "command missing");
  assert.ok(text.includes("hello"), "output missing");
});

test("renders a cancelled bash execution as an error", () => {
  const text = visibleText(
    renderMessage({
      role: "bashExecution",
      command: "sleep 30",
      output: "",
      cancelled: true,
    }),
  );

  assert.ok(text.includes("sleep 30"), "command missing");
});
