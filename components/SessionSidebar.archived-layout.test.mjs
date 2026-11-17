/**
 * 归档区在真实渲染下的高度分配：条目多过剩余空间时，列表在自己的滚动区里滚动，
 * 最后一条可以到达；条目少时区的高度跟着内容收缩，不占满一半侧栏。
 *
 * 覆盖的是纯布局行为，只能靠真实 DOM 的几何读出来：源码文本断言看不出
 * flex 收缩与滚动区是否生效。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

import { installDom, mount } from "../test-support/dom-harness.mjs";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { SessionSidebar } = await jiti.import("./SessionSidebar.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const ARCHIVED_COUNT = 30;

function sessionInfo(index) {
  return {
    path: `C:/tmp/sessions/${index}.jsonl`,
    id: `session-${index}`,
    cwd: "C:/tmp/project",
    name: `会话 ${index}`,
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "hello",
    transient: false,
  };
}

/** 只应答侧栏会请求的接口；其它请求返回空对象，避免未处理的 Promise。 */
function stubFetch({ archived }) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith("/api/sessions?archived=1")) {
      return new Response(JSON.stringify({ sessions: archived }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.startsWith("/api/sessions")) {
      return new Response(JSON.stringify({ sessions: [], runningSessionIds: [], waitingSessionIds: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.startsWith("/api/agent/running")) {
      return new Response(JSON.stringify({ runningSessionIds: [], waitingSessionIds: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return () => {
    globalThis.fetch = original;
  };
}

/** 等归档区的列表渲染出来；它来自一次异步请求。 */
async function waitForArchivedRows(container, expected) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const rows = container.querySelectorAll(".sidebar-archived-toggle + div [data-session-id]");
    if (rows.length === expected) return rows;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`归档区没有渲染出 ${expected} 行`);
}

/** 等归档开关出现；它来自一次异步请求。 */
async function waitForToggle(container) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const toggle = container.querySelector(".sidebar-archived-toggle");
    if (toggle) return toggle;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("归档区开关没有渲染出来");
}

test("归档列表在自己的滚动区里滚到最后一条", async () => {
  const restore = installDom();
  const restoreFetch = stubFetch({ archived: Array.from({ length: ARCHIVED_COUNT }, (_, i) => sessionInfo(i)) });
  try {
    const view = mount(
      SessionSidebar,
      {
        selectedSessionId: null,
        onSelectSession: () => {},
      },
      I18nProvider,
    );

    const toggle = await waitForToggle(view.container);
    toggle.click();

    await waitForArchivedRows(view.container, ARCHIVED_COUNT);
    const list = toggle.nextElementSibling;
    // happy-dom 不做真实布局，几何值恒为零；断言样式契约，滚动能力本身由浏览器实测覆盖。
    assert.equal(list.style.overflowY, "auto", "归档列表必须有自己的滚动区");
    assert.equal(list.style.flex, "1 1 auto", "列表必须在剩余高度里伸缩");
    assert.equal(list.style.minHeight, "0", "列表必须能收缩到比内容更矮");
    assert.equal(toggle.style.flexShrink, "0", "开关不能被列表挤掉");

    const section = toggle.parentElement;
    assert.equal(section.style.maxHeight, "50%", "归档区高度上限为侧栏的一半");
    assert.equal(section.style.minHeight, "0");
    assert.equal(section.style.overflowY, "", "滚动交给内层列表，外层不再叠一层滚动区");

    view.unmount();
  } finally {
    restoreFetch();
    await restore();
  }
});

test("归档区没有条目时不渲染", async () => {
  const restore = installDom();
  const restoreFetch = stubFetch({ archived: [] });
  try {
    const view = mount(SessionSidebar, { selectedSessionId: null, onSelectSession: () => {} }, I18nProvider);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(view.container.querySelector(".sidebar-archived-toggle"), null);
    view.unmount();
  } finally {
    restoreFetch();
    await restore();
  }
});
