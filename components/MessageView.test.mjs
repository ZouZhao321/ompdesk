import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MessageView } = await jiti.import("./MessageView.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const { ImagePreviewProvider } = await jiti.import("./ImageZoom.tsx");
const { transcriptViewState, thinkingPart } = await jiti.import("../lib/transcript-view-state.ts");
const source = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");

function renderMessage(message, { withPreview = false } = {}) {
  const view = React.createElement(MessageView, { message });
  const wrapped = withPreview ? React.createElement(ImagePreviewProvider, null, view) : view;

  return renderToStaticMarkup(React.createElement(I18nProvider, null, wrapped));
}

test("renders a provider error when the assistant message has no content", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [],
    stopReason: "error",
    errorMessage: "OpenAI API error (403): <html>request forbidden</html>",
  });

  assert.match(html, /role="alert"/);
  assert.match(html, /Error: OpenAI API error \(403\)/);
  assert.match(html, /&lt;html&gt;request forbidden&lt;\/html&gt;/);
});

test("renders partial assistant content before the provider error", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "text", text: "Partial response" }],
    stopReason: "error",
    errorMessage: "Connection closed",
  });

  assert.match(html, /Partial response/);
  assert.match(html, /Error: Connection closed/);
});

test("renders shell blocks as themed terminal content", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MessageView, {
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-test",
          content: [{
            type: "toolCall",
            toolCallId: "shell-1",
            toolName: "bash",
            input: { command: "git status --short" },
          }],
        },
        toolResults: new Map([
          ["shell-1", {
            role: "toolResult",
            toolCallId: "shell-1",
            content: [{ type: "text", text: "staged 0, unstaged 1\n M components/MessageView.tsx" }],
          }],
        ]),
      }),
    ),
  );

  assert.match(html, /class="shell-output-preview"/);
  assert.match(html, /git<\/span>/);
  assert.match(html, /--short/);
  assert.match(html, /Output/);
  assert.match(html, /components\/MessageView\.tsx/);
});

test("uses i/title in the standard header for grep, read, write, glob, and eval blocks", () => {
  const cases = [
    ["read", "i", "Verifico bridge startSessionReplay e campionamento", { i: "Verifico bridge startSessionReplay e campionamento", path: "lib/main.dart" }, "lib/main.dart"],
    ["grep", "i", "Individuo avvio e stop del session replay", { i: "Individuo avvio e stop del session replay", path: "lib/main.dart" }, "lib/main.dart"],
    ["write", "i", "Individuo simbolo Main dell'app Flutter", { i: "Individuo simbolo Main dell'app Flutter", path: "lib/main.dart" }, "lib/main.dart"],
    ["glob", "i", "Individuo componenti TypeScript", { i: "Individuo componenti TypeScript", path: "components/**/*.tsx" }, "components/**/*.tsx"],
    ["eval", "title", "Valuto il risultato del parser", { title: "Valuto il risultato del parser", code: "return 42" }, "return 42"],
  ];

  for (const [toolName, property, preview, input, fallback] of cases) {
    const html = renderMessage({
      role: "assistant",
      provider: "openai",
      model: "gpt-test",
      content: [{
        type: "toolCall",
        toolCallId: `${toolName}-preview`,
        toolName,
        input,
      }],
    });

    const renderedPreview = preview.replaceAll("'", "&#x27;");
    const previewPosition = html.indexOf(renderedPreview);
    const toolPosition = html.indexOf(`>${toolName}</span>`);
    assert.ok(previewPosition > toolPosition, `expected ${property} from ${toolName} in the standard header`);
    assert.doesNotMatch(html, /class="tool-intent-preview"/);
    assert.ok(!html.includes(fallback), `expected ${toolName} fallback to stay out of the header`);
  }
});

test("shows an operation icon beside every standard tool label", () => {
  const cases = [
    ["read", "read", "var(--accent)"],
    ["write", "write", "var(--warning)"],
    ["glob", "glob", "var(--accent-hover)"],
    ["grep", "grep", "var(--accent)"],
    ["edit", "edit", "var(--warning)"],
    ["eval", "eval", "var(--accent-hover)"],
    ["functions.task", "task", "var(--accent)"],
    ["unknown_tool", "generic", "var(--text-dim)"],
  ];

  for (const [toolName, iconKind, themeColor] of cases) {
    const html = renderMessage({
      role: "assistant",
      provider: "openai",
      model: "gpt-test",
      content: [{
        type: "toolCall",
        toolCallId: `${toolName}-icon`,
        toolName,
        input: {},
      }],
    });

    const iconPosition = html.indexOf(`data-tool-icon="${iconKind}"`);
    const iconEnd = html.indexOf(">", iconPosition);
    const toolPosition = html.indexOf(`>${toolName}</span>`);
    assert.ok(iconPosition >= 0, `expected ${iconKind} icon for ${toolName}`);
    assert.ok(html.slice(iconPosition, iconEnd).includes(`color:${themeColor}`), `expected ${toolName} icon to use ${themeColor}`);
    assert.ok(iconPosition < toolPosition, `expected ${iconKind} icon before ${toolName}`);
  }
});


test("renders every todo task in an integrated checklist", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MessageView, {
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-test",
          content: [{
            type: "toolCall",
            toolCallId: "todo-1",
            toolName: "todo",
            input: {
              list: [{
                phase: "Implementation",
                items: ["First task", "Second task", "Third task", "Fourth task"],
              }],
            },
          }],
        },
        toolResults: new Map([
          ["todo-1", {
            role: "toolResult",
            toolCallId: "todo-1",
            details: {
              phases: [{
                name: "Implementation",
                tasks: [
                  { content: "First task", status: "completed" },
                  { content: "Second task", status: "completed" },
                  { content: "Third task", status: "in_progress" },
                  { content: "Fourth task", status: "pending" },
                ],
              }],
            },
            content: [],
          }],
        ]),
      }),
    ),
  );

  assert.match(html, /class="todo-checklist-preview"/);
  assert.match(html, /Todo 4 tasks/);
  assert.match(html, /First task/);
  assert.match(html, /Second task/);
  assert.match(html, /Third task/);
  assert.match(html, /Fourth task/);
  assert.doesNotMatch(html, /… 1/);
});

test("renders thinking markdown directly without a collapsible card", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MessageView, {
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-test",
          content: [{ type: "thinking", thinking: "**Direct thought**" }],
        },
      }),
    ),
  );

  assert.match(html, /class="markdown-thinking"/);
  assert.match(html, /<strong>Direct thought<\/strong>/);
  assert.doesNotMatch(html, /aria-expanded/);
});

test("skips the loading state once a deferred thought has been fetched", () => {
  const message = {
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "thinking", thinking: "", deferred: true }],
  };
  const renderThinking = () => renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MessageView, {
        message,
        sessionId: "session-thinking",
        entryId: "entry-thinking",
        turnAnchorEntryId: "entry-thinking",
      }),
    ),
  );

  assert.match(renderThinking(), /Loading thinking\.\.\./);

  // 内容取回过之后条目被卸载重建：正文与标记一起在视图状态里，首帧就是正文，
  // 既不再请求也不回落占位文案。
  transcriptViewState.markLoaded("session-thinking", "entry-thinking", thinkingPart("entry-thinking", 0), "先看一下这条消息");

  const html = renderThinking();
  assert.doesNotMatch(html, /Loading thinking/);
  assert.match(html, /markdown-thinking-body/);
  assert.match(html, /先看一下这条消息/);
  assert.doesNotMatch(html, /class="markdown-thinking-status"/);
  assert.doesNotMatch(html, /class="markdown-thinking-error"/);
});

test("renders an available thought ahead of loading and error markup", () => {
  // SSR 不跑 effect：正文与错误同时在手的那一帧由 lib/message-display.test.mjs 的
  // thinkingDisplayState 用例锁住，这里锁组件真的按这个优先级排版。
  assert.match(source, /const display = thinkingDisplayState\(hasText, loading, error\);/);
  assert.match(
    source,
    /display === "text" \? \(\s*<MarkdownBody className="markdown-thinking-body">\{text \?\? ""\}<\/MarkdownBody>\s*\) : display === "loading" \?/,
  );
});

test("keeps bash and todo blocks off the expand-state subscription", () => {
  // 展开状态只在折叠卡片里读：bash 与待办在前面就提前返回，不该订整个视图仓库。
  assert.equal(source.match(/useTranscriptExpanded\(/g)?.length, 1);
  const cardIndex = source.indexOf("function ToolCallCard(");
  assert.ok(cardIndex !== -1, "MessageView must declare ToolCallCard");
  assert.ok(
    source.indexOf("useTranscriptExpanded(") > cardIndex,
    "useTranscriptExpanded must live in ToolCallCard",
  );
  // bash 输出预览记忆化，行切分与高亮都收在 useMemo 里，展开别处的块不再重跑。
  assert.match(source, /const ConsoleOutputPreview = memo\(function ConsoleOutputPreview\(/);
  assert.match(source, /\{lineElements\}/);
});

test("reads a deferred thought that was saved without a session id", () => {
  // 还没落盘的会话没有 sessionId：写入落在空会话桶，读也只按 entryId 定位，
  // 读写因此落在同一个位置。
  // 这里只锁首帧：SSR 不跑 effect，effect 里「已有正文就不落错误」的那条分支由
  // lib/transcript-view-state.test.mjs 的 planDeferredContent 用例覆盖。
  transcriptViewState.markLoaded(
    undefined,
    "entry-unsaved",
    thinkingPart("entry-unsaved", 0),
    "尚未落盘的正文",
  );

  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MessageView, {
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-test",
          content: [{ type: "thinking", thinking: "", deferred: true }],
        },
        entryId: "entry-unsaved",
      }),
    ),
  );

  assert.match(html, /尚未落盘的正文/);
  assert.doesNotMatch(html, /Loading thinking/);
});

const userImageMessage = {
  role: "user",
  content: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
  timestamp: 1750000000000,
};

test("renders chat attachments as preview buttons when a preview host is mounted", () => {
  const html = renderMessage(userImageMessage, { withPreview: true });

  assert.match(html, /<button[^>]*class="message-image-button"/);
  assert.match(html, /src="data:image\/png;base64,AAAA"/);
});

test("keeps chat attachment images when no preview host is mounted", () => {
  const html = renderMessage(userImageMessage);

  assert.match(html, /<img[^>]*src="data:image\/png;base64,AAAA"/);
  assert.doesNotMatch(html, /message-image-button/);
});
