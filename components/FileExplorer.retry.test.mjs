/**
 * 文件树失败目录的重试覆盖：用 happy-dom 提供真实 DOM，点目录行后断言用户可见的
 * 结果——是否真的又发了一次列表请求、提示是否消失、内容是否出现。
 *
 * React DOM 必须在 DOM 全局对象注册之后再加载，否则退化到不触发合成事件的路径，
 * 所以下面的包全部走动态 import。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost:30141" });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { flushSync } = await import("react-dom");
const { createJiti } = await import("jiti");

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { FileExplorer } = await jiti.import("./FileExplorer.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const CWD = "/project";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function listedDir(url) {
  const [pathname] = url.split("?");
  return `/${decodeURIComponent(pathname.slice("/api/files/".length))}`;
}

/**
 * 安装 fetch 替身。`plan` 给出每个目录的响应序列：每次请求取下一个，用完之后一直用
 * 最后一个。这样「先失败、后成功」的重试过程可以在同一个用例里验证。
 */
function stubFetch(plan) {
  const previous = globalThis.fetch;
  const calls = [];
  const taken = new Map();
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/api/git/status")) return jsonResponse(200, { isGitRepository: false, files: [] });
    const dir = listedDir(url);
    if (dir === CWD) return jsonResponse(200, { entries: ROOT_ENTRIES });
    const sequence = plan[dir];
    if (!sequence) return jsonResponse(200, { entries: [] });
    const index = Math.min(taken.get(dir) ?? 0, sequence.length - 1);
    taken.set(dir, (taken.get(dir) ?? 0) + 1);
    const outcome = sequence[index];
    if (outcome === "throw") throw new TypeError("Failed to fetch");
    return jsonResponse(outcome.status, outcome.body);
  };
  return {
    calls,
    callsFor: (dir) => calls.filter((url) => listedDir(url) === dir).length,
    restore: () => (globalThis.fetch = previous),
  };
}

const ROOT_ENTRIES = ["locked", "plain"].map((name) => ({ name, isDir: true, size: 0, modified: "" }));

async function settle(rounds = 4) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync(() => {});
  }
}

async function mountExplorer(plan) {
  globalThis.localStorage.setItem("pi-locale", "en");
  const stub = stubFetch(plan);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = (refreshKey) =>
    React.createElement(
      I18nProvider,
      { initialLocale: "en" },
      React.createElement(FileExplorer, {
        cwd: CWD,
        onOpenFile: () => {},
        changesCollapsed: true,
        refreshKey,
      }),
    );
  flushSync(() => root.render(render(0)));
  await settle();
  return {
    container,
    stub,
    refresh: async (key) => {
      flushSync(() => root.render(render(key)));
      await settle();
    },
    unmount: () => {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
}

function rowByName(container, name) {
  const label = [...container.querySelectorAll("span")].find((node) => node.textContent === name);
  return label?.parentElement;
}

async function click(view, name) {
  const row = rowByName(view.container, name);
  assert.ok(row, `expected a row named ${name}`);
  flushSync(() => row.click());
  await settle();
}

function alerts(container) {
  return [...container.querySelectorAll('[role="alert"]')].map((node) => node.textContent);
}

test("clicking a failed directory requests it again instead of collapsing it", async () => {
  const view = await mountExplorer({ [`${CWD}/locked`]: [{ status: 403, body: {} }] });
  try {
    await click(view, "locked");
    assert.equal(alerts(view.container).length, 1);
    const before = view.stub.callsFor(`${CWD}/locked`);

    await click(view, "locked");

    assert.ok(view.stub.callsFor(`${CWD}/locked`) > before, "the retry issues another request");
    // 提示仍在：仍展开，且这一轮还是失败。
    assert.equal(alerts(view.container).length, 1, "the node stays expanded with its hint");
  } finally {
    view.unmount();
    view.stub.restore();
  }
});

test("a successful retry clears the hint and shows the contents", async () => {
  const view = await mountExplorer({
    [`${CWD}/locked`]: [
      { status: 403, body: {} },
      { status: 200, body: { entries: [{ name: "inside.txt", isDir: false, size: 3, modified: "" }] } },
    ],
  });
  try {
    await click(view, "locked");
    assert.equal(alerts(view.container).length, 1);

    await click(view, "locked");

    assert.deepEqual(alerts(view.container), []);
    assert.match(view.container.textContent, /inside\.txt/);
  } finally {
    view.unmount();
    view.stub.restore();
  }
});

test("a retry that fails again keeps a hint", async () => {
  const view = await mountExplorer({
    [`${CWD}/locked`]: [
      { status: 403, body: {} },
      { status: 500, body: {} },
    ],
  });
  try {
    await click(view, "locked");
    await click(view, "locked");
    const shown = alerts(view.container);
    assert.equal(shown.length, 1);
    assert.match(shown[0], /500/);
  } finally {
    view.unmount();
    view.stub.restore();
  }
});

test("refreshing the tree re-requests an expanded failed directory", async () => {
  const view = await mountExplorer({
    [`${CWD}/locked`]: [
      { status: 403, body: {} },
      { status: 200, body: { entries: [] } },
    ],
  });
  try {
    await click(view, "locked");
    assert.equal(alerts(view.container).length, 1);
    const before = view.stub.callsFor(`${CWD}/locked`);

    await view.refresh(1);

    assert.ok(view.stub.callsFor(`${CWD}/locked`) > before, "the refresh re-requests the failed directory");
    assert.deepEqual(alerts(view.container), []);
  } finally {
    view.unmount();
    view.stub.restore();
  }
});

test("refreshing keeps re-fetching a normally loaded directory", async () => {
  const view = await mountExplorer({
    [`${CWD}/plain`]: [
      { status: 200, body: { entries: [] } },
      { status: 200, body: { entries: [{ name: "later.txt", isDir: false, size: 1, modified: "" }] } },
    ],
  });
  try {
    await click(view, "plain");
    const before = view.stub.callsFor(`${CWD}/plain`);

    await view.refresh(1);

    assert.ok(view.stub.callsFor(`${CWD}/plain`) > before, "the refresh re-requests the loaded directory");
    assert.match(view.container.textContent, /later\.txt/);
  } finally {
    view.unmount();
    view.stub.restore();
  }
});
