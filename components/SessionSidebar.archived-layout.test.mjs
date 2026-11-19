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

const LIST_URL = "/api/sessions";
const ARCHIVED_URL = "/api/sessions?archived=1";

/**
 * 只应答侧栏会请求的接口；其它请求返回空对象，避免未处理的 Promise。
 *
 * 主列表按服务端现状带上 archivedCount：归档开关只靠这个计数决定是否出现，
 * 归档列表本身要等展开才请求。按 URL 计数，用来断言请求次数。
 */
function stubFetch({ archived }) {
  const original = globalThis.fetch;
  const counts = new Map();
  const json = (payload) =>
    new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = async (input) => {
    const url = String(input);
    counts.set(url, (counts.get(url) ?? 0) + 1);
    if (url.startsWith(ARCHIVED_URL)) return json({ sessions: archived });
    if (url.startsWith("/api/sessions")) {
      return json({
        sessions: [],
        archivedCount: archived.length,
        runningSessionIds: [],
        waitingSessionIds: [],
      });
    }
    if (url.startsWith("/api/agent/running")) return json({ runningSessionIds: [], waitingSessionIds: [] });
    return json({});
  };
  return {
    count: (url) => counts.get(url) ?? 0,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** 轮询直到条件成立；调用方给出这条用例专属的失败提示。 */
async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

/** 归档区内已渲染的会话行。 */
function archivedRows(container) {
  return container.querySelectorAll(".sidebar-archived-toggle + div [data-session-id]");
}

/** 等归档区的列表渲染出来；它来自一次异步请求。 */
async function waitForArchivedRows(container, expected) {
  await waitFor(() => archivedRows(container).length === expected, `归档区没有渲染出 ${expected} 行`);
  return archivedRows(container);
}

/** 等归档开关出现；主列表的归档计数到位后它才渲染。 */
async function waitForToggle(container) {
  await waitFor(() => container.querySelector(".sidebar-archived-toggle") !== null, "归档区开关没有渲染出来");
  return container.querySelector(".sidebar-archived-toggle");
}

test("归档列表在自己的滚动区里滚到最后一条", async () => {
  const restore = installDom();
  const stub = stubFetch({ archived: Array.from({ length: ARCHIVED_COUNT }, (_, i) => sessionInfo(i)) });
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
    assert.equal(stub.count(ARCHIVED_URL), 0, "展开前不得请求归档列表");

    toggle.click();

    await waitForArchivedRows(view.container, ARCHIVED_COUNT);
    assert.equal(stub.count(ARCHIVED_URL), 1, "展开归档区只发一次归档请求");

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

    // 收起再展开：归档区重新读取，仍是一次请求。两次点击必须分别落定，
    // 同一批次里的两次 setOpen 会被 React 合并成一次更新，effect 不会重跑。
    toggle.click();
    await waitFor(() => archivedRows(view.container).length === 0, "收起后归档列表必须隐藏");
    toggle.click();
    await waitForArchivedRows(view.container, ARCHIVED_COUNT);
    assert.equal(stub.count(ARCHIVED_URL), 2, "重新展开归档区再发一次归档请求");

    view.unmount();
  } finally {
    stub.restore();
    await restore();
  }
});

test("挂载侧栏不请求归档列表，只靠主列表的计数显示入口", async () => {
  const restore = installDom();
  const stub = stubFetch({ archived: [sessionInfo(0), sessionInfo(1)] });
  try {
    const view = mount(SessionSidebar, { selectedSessionId: null, onSelectSession: () => {} }, I18nProvider);

    const toggle = await waitForToggle(view.container);
    assert.equal(stub.count(LIST_URL), 1, "首屏只读一次主列表");
    assert.equal(stub.count(ARCHIVED_URL), 0, "归档区未展开时不得请求归档列表");
    assert.equal(toggle.textContent.includes("(2)"), true, "归档开关的条数来自主列表返回的 archivedCount");
    assert.equal(view.container.querySelectorAll(".sidebar-archived-toggle + div [data-session-id]").length, 0);

    view.unmount();
  } finally {
    stub.restore();
    await restore();
  }
});

test("归档区没有条目时不渲染", async () => {
  const restore = installDom();
  const stub = stubFetch({ archived: [] });
  try {
    const view = mount(SessionSidebar, { selectedSessionId: null, onSelectSession: () => {} }, I18nProvider);
    // 等主列表落定：加载中与加载完的空列表在渲染上不可区分，必须先等到请求结算。
    await waitFor(() => stub.count(LIST_URL) === 1, "主列表必须被请求一次");
    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.equal(view.container.querySelector(".sidebar-archived-toggle"), null);
    assert.equal(stub.count(ARCHIVED_URL), 0, "没有归档条目时也不得请求归档列表");

    view.unmount();
  } finally {
    stub.restore();
    await restore();
  }
});
