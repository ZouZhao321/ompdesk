import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postcss from "postcss";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MessageView } = await jiti.import("./MessageView.tsx");
const { TurnWrittenFiles } = await jiti.import("./TurnWrittenFiles.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const MOBILE_QUERY = "(max-width: 768px), (pointer: coarse) and (max-height: 480px)";

async function readMobileDeclarations() {
  const source = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const declarations = new Map();
  postcss.parse(source).walkAtRules("media", (atRule) => {
    if (atRule.params !== MOBILE_QUERY) return;
    atRule.walkRules((rule) => {
      for (const selector of rule.selectors) {
        const props = declarations.get(selector) ?? new Map();
        rule.walkDecls((decl) => {
          props.set(decl.prop, { value: decl.value, important: decl.important });
        });
        declarations.set(selector, props);
      }
    });
  });
  return declarations;
}

function assertDeclaration(declarations, selector, prop, value, important = false) {
  const declaration = declarations.get(selector)?.get(prop);
  assert.ok(declaration, `${selector} should declare ${prop} in the mobile block`);
  assert.equal(declaration.value, value, `${selector} ${prop}`);
  assert.equal(Boolean(declaration.important), Boolean(important), `${selector} ${prop} importance`);
}

function render(element) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, element));
}

test("mobile message controls are 44×44 hit targets", async () => {
  const declarations = await readMobileDeclarations();

  for (const selector of [".message-action-button", ".message-inline-action", ".file-chip-button"]) {
    assertDeclaration(declarations, selector, "min-width", "44px");
    assertDeclaration(declarations, selector, "min-height", "44px");
  }
  for (const selector of [".message-reveal-button", ".compaction-file-summary", ".tool-call-toggle"]) {
    assertDeclaration(declarations, selector, "min-height", "44px");
  }
  assertDeclaration(declarations, ".process-details-toggle", "min-width", "44px");
  assertDeclaration(declarations, ".process-details-toggle", "min-height", "44px", true);
  assertDeclaration(declarations, ".tool-call-toggle", "width", "100%");
});

test("touch has no hover, so the message action bars stay visible", async () => {
  const declarations = await readMobileDeclarations();

  assertDeclaration(declarations, ".message-action-reveal", "opacity", "1", true);
  assertDeclaration(declarations, ".message-action-reveal", "pointer-events", "auto", true);
});

test("user message actions carry the mobile hit-target classes", () => {
  const html = render(React.createElement(MessageView, {
    message: { role: "user", content: "hello", timestamp: Date.now() },
    entryId: "entry-1",
    prevAssistantEntryId: "entry-2",
    onFork() {},
    onNavigate() {},
  }));

  assert.equal((html.match(/class="message-action-reveal"/g) ?? []).length, 2);
  assert.equal((html.match(/class="message-action-button"/g) ?? []).length, 3);
});

test("assistant copy, tool-call row and written-file chips are mobile targets", () => {
  const html = render(React.createElement(MessageView, {
    message: {
      role: "assistant",
      provider: "openai",
      model: "gpt-test",
      content: [
        { type: "text", text: "done" },
        { type: "toolCall", toolCallId: "read-1", toolName: "read", input: { path: "a.ts" } },
      ],
      timestamp: Date.now(),
    },
    writtenFiles: [{ filePath: "components/a.ts" }],
  }));

  assert.match(html, /message-action-reveal message-action-button/);
  assert.match(html, /class="tool-call-toggle"/);
  assert.match(html, /class="file-chip-button"/);
});

test("custom message footer and collapsed body use mobile targets", () => {
  const expanded = render(React.createElement(MessageView, {
    message: { role: "custom", customType: "extension", content: "hello", display: true, details: { ok: true } },
  }));
  assert.equal((expanded.match(/class="message-action-button"/g) ?? []).length, 2);

  const collapsed = render(React.createElement(MessageView, {
    message: { role: "custom", customType: "extension", content: "hello", display: false },
  }));
  assert.match(collapsed, /class="message-reveal-button"/);
});

test("written file chips render with the mobile target class", () => {
  const html = render(React.createElement(TurnWrittenFiles, {
    files: [{ filePath: "components/a.ts" }],
  }));
  assert.match(html, /class="file-chip-button"/);
});

test("the process details toggle carries the mobile target class", async () => {
  const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  assert.match(source, /className="process-details-toggle"/);
});
