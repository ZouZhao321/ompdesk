import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { flushSync } from "react-dom";

import { installDom, mount } from "../test-support/dom-harness.mjs";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { MermaidBlock } = await jiti.import("./MermaidBlock.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function clickSync(element) {
  flushSync(() => {
    element.click();
  });
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

test("preview button switches between source and rendered diagram", async () => {
  const restore = installDom();
  try {
    const view = mount(MermaidBlock, { code: "graph TD; A-->B;", defaultPreview: false }, I18nProvider);
    assert.ok(view.container.textContent.includes("mermaid"), "source view missing");

    const previewButton = view.container.querySelector(".markdown-code-action");
    clickSync(previewButton);

    const rendered = await waitFor(() => view.container.querySelector(".mermaid-preview-button"));
    assert.ok(rendered, "rendered diagram did not appear");
    assert.ok(rendered.getAttribute("aria-label"), "rendered diagram is unlabelled");

    view.unmount();
  } finally {
    await restore();
  }
});

test("invalid diagram shows the error message", async () => {
  const restore = installDom();
  try {
    const view = mount(MermaidBlock, { code: "not a diagram {{{", defaultPreview: true }, I18nProvider);

    const error = await waitFor(() => view.container.querySelector(".mermaid-block-error"));
    assert.ok(error, "error state missing");

    view.unmount();
  } finally {
    await restore();
  }
});

test("rendered diagram opens a zoom dialog with working controls", async () => {
  const restore = installDom();
  try {
    const view = mount(MermaidBlock, { code: "graph LR; X-->Y;", defaultPreview: true }, I18nProvider);
    const rendered = await waitFor(() => view.container.querySelector(".mermaid-preview-button"));
    assert.ok(rendered, "rendered diagram did not appear");

    clickSync(rendered);
    const dialog = await waitFor(() => view.container.querySelector("dialog"));
    assert.ok(dialog, "zoom dialog missing");

    const buttons = dialog.querySelectorAll(".mermaid-zoom-icon-button");
    assert.equal(buttons.length, 2, "zoom reset and close buttons expected");
    assert.ok(dialog.querySelector("[aria-label]"), "dialog controls are unlabelled");

    view.unmount();
  } finally {
    await restore();
  }
});

test("copy button in the source view writes the diagram source", async () => {
  const restore = installDom();
  try {
    const copied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text) => copied.push(text) },
    });

    const view = mount(MermaidBlock, { code: "graph TD; A-->B;", defaultPreview: false }, I18nProvider);
    const actions = view.container.querySelectorAll(".markdown-code-action");
    const copyButton = actions[actions.length - 1];
    assert.ok(copyButton, "copy button missing");
    clickSync(copyButton);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(copied, ["graph TD; A-->B;"]);

    view.unmount();
  } finally {
    await restore();
  }
});
