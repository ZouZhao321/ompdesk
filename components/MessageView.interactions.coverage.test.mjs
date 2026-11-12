import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { flushSync } from "react-dom";

import { installDom, mount } from "../test-support/dom-harness.mjs";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { MessageView } = await jiti.import("./MessageView.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

function clickSync(element) {
  flushSync(() => {
    element.click();
  });
}

function mountMessage(message, props = {}) {
  return mount(MessageView, { message, ...props }, I18nProvider);
}

function installClipboard() {
  const copied = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text) => {
        copied.push(text);
      },
    },
  });
  return copied;
}

test("user message copy button sends its text to the clipboard", async () => {
  const restore = installDom();
  try {
    const copied = installClipboard();
    const view = mountMessage({ role: "user", content: "复制这段用户文本", timestamp: 1_700_000_000_000 });

    clickSync(view.container.querySelector(".message-action-button"));
    await settle();
    assert.deepEqual(copied, ["复制这段用户文本"]);

    view.unmount();
  } finally {
    await restore();
  }
});

test("custom message copy button sends the visible body", async () => {
  const restore = installDom();
  try {
    const copied = installClipboard();
    const view = mountMessage({ role: "custom", customType: "note", display: true, content: "自定义正文" });

    clickSync(view.container.querySelector(".message-action-button"));
    await settle();
    assert.deepEqual(copied, ["自定义正文"]);

    view.unmount();
  } finally {
    await restore();
  }
});

test("hidden custom message expands to its body", async () => {
  const restore = installDom();
  try {
    const view = mountMessage({ role: "custom", customType: "note", display: false, content: "折叠的正文内容" });
    assert.equal(view.container.querySelector(".message-reveal-button") !== null, true);

    clickSync(view.container.querySelector(".message-reveal-button"));
    await settle();
    assert.ok(view.container.textContent.includes("折叠的正文内容"));

    view.unmount();
  } finally {
    await restore();
  }
});

test("custom message details toggle reveals the serialized details", async () => {
  const restore = installDom();
  try {
    const view = mountMessage({
      role: "custom",
      customType: "note",
      display: true,
      content: "正文",
      details: { marker: "detail-value" },
    });

    const toggle = Array.from(view.container.querySelectorAll(".message-action-button")).at(-1);
    clickSync(toggle);
    await settle();
    assert.ok(view.container.textContent.includes("detail-value"));

    view.unmount();
  } finally {
    await restore();
  }
});

test("skill prompt expands to its body", async () => {
  const restore = installDom();
  try {
    const view = mountMessage({
      role: "custom",
      customType: "skill-prompt",
      attribution: "user",
      display: true,
      content: "技能正文内容",
      details: { prompt: "/skill:demo", name: "demo" },
    });

    clickSync(view.container.querySelector(".message-action-button"));
    await settle();
    assert.ok(view.container.textContent.includes("技能正文内容"));

    view.unmount();
  } finally {
    await restore();
  }
});

test("a plain tool result renders its text after the call is expanded", async () => {
  const restore = installDom();
  try {
    const view = mountMessage(
      {
        role: "assistant",
        model: "mock",
        provider: "mock",
        content: [{ type: "toolCall", toolCallId: "call-plain", toolName: "read", input: { path: "src/a.ts" } }],
      },
      {
        toolResults: new Map([
          [
            "call-plain",
            {
              role: "toolResult",
              toolCallId: "call-plain",
              toolName: "read",
              content: [{ type: "text", text: "plain body text" }],
            },
          ],
        ]),
      },
    );

    clickSync(view.container.querySelector(".tool-call-toggle"));
    await settle();
    assert.ok(view.container.textContent.includes("plain body text"));

    view.unmount();
  } finally {
    await restore();
  }
});

test("truncated bash output can load its full body", async () => {
  const restore = installDom();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ success: true, data: { output: "full output body" } }), {
        headers: { "content-type": "application/json" },
      });

    const view = mountMessage(
      {
        role: "bashExecution",
        command: "seq 1 10",
        output: "1\n2\n3",
        exitCode: 0,
        truncated: true,
        fullOutputPath: "C:/tmp/full.log",
        timestamp: 1_700_000_000_000,
      },
      { sessionId: "session-fixture" },
    );

    const button = Array.from(view.container.querySelectorAll("button")).find((item) =>
      item.textContent.includes("view full output"),
    );
    assert.ok(button, "full output button missing");
    clickSync(button);
    await settle();
    assert.ok(view.container.textContent.includes("full output body"));

    view.unmount();
  } finally {
    globalThis.fetch = originalFetch;
    await restore();
  }
});
