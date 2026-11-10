import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { flushSync } from "react-dom";

import { installDom, mount } from "../test-support/dom-harness.mjs";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { LogsPanelView } = await jiti.import("./LogsPanelView.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const styles = new Proxy({}, { get: (_target, key) => String(key) });
const noop = () => {};

function props(overrides = {}) {
  return {
    styles,
    files: [
      { name: "ompdesk.log", size: 2048, modifiedAt: 1_700_000_000_000, current: true },
      { name: "ompdesk.log.1", size: 1024, modifiedAt: 1_699_000_000_000, current: false },
    ],
    file: { name: "ompdesk.log", size: 2048, modifiedAt: 1_700_000_000_000, current: true },
    entries: [
      {
        offset: 0,
        length: 40,
        raw: '{"level":"info","message":"first line"}',
        level: "info",
        timestamp: "2026-10-24T15:00:00.000+08:00",
        source: "ompdesk",
        subsystem: "http",
        message: "first line",
        fields: { level: "info", message: "first line" },
      },
    ],
    level: "all",
    keyword: "",
    follow: true,
    paused: false,
    loading: false,
    error: null,
    catchingUp: false,
    selectedFile: "ompdesk.log",
    expandedOffset: null,
    onLevelChange: noop,
    onKeywordChange: noop,
    onFileChange: noop,
    onFollowChange: noop,
    onTogglePause: noop,
    onRefresh: noop,
    onToggleEntry: noop,
    ...overrides,
  };
}

function clickSync(element) {
  flushSync(() => {
    element.click();
  });
}

function changeSync(element, value) {
  flushSync(() => {
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

test("level, file, follow, pause, refresh, entry and scroll controls report their events", async () => {
  const restore = installDom();
  try {
    const calls = [];
    const view = mount(
      LogsPanelView,
      props({
        onLevelChange: (value) => calls.push(["level", value]),
        onFileChange: (value) => calls.push(["file", value]),
        onFollowChange: (value) => calls.push(["follow", value]),
        onTogglePause: () => calls.push(["pause"]),
        onRefresh: () => calls.push(["refresh"]),
        onToggleEntry: (offset) => calls.push(["entry", offset]),
        onListScroll: () => calls.push(["scroll"]),
      }),
      I18nProvider,
    );

    const [levelSelect, fileSelect] = view.container.querySelectorAll("select");
    changeSync(levelSelect, "error");
    changeSync(fileSelect, "ompdesk.log.1");

    const actions = view.container.querySelectorAll("button.action");
    clickSync(actions[0]);
    clickSync(actions[1]);
    clickSync(actions[2]);

    clickSync(view.container.querySelector(".entry button"));
    view.container.querySelector(".list").dispatchEvent(new Event("scroll"));

    assert.deepEqual(calls, [
      ["level", "error"],
      ["file", "ompdesk.log.1"],
      ["follow", false],
      ["pause"],
      ["refresh"],
      ["entry", 0],
      ["scroll"],
    ]);

    view.unmount();
  } finally {
    await restore();
  }
});
