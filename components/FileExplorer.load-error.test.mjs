/**
 * 文件树目录加载失败的交互覆盖：用 happy-dom 提供真实 DOM，React 通过 createRoot +
 * flushSync 同步渲染，点目录行后断言用户可见的提示文字。
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
const { enLocale } = await jiti.import("../lib/i18n/messages/en.ts");
const { zhCNLocale } = await jiti.import("../lib/i18n/messages/zh-CN.ts");
const { describeFileLoadFailure } = await jiti.import("../lib/file-load-error.ts");

const CWD = "/project";
const DIRS = ["locked", "broken", "offline", "blank"];

/** 目录列表请求的响应替身；只实现组件真正读取的三个成员。 */
function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** 从请求地址里取出被列出的目录，供按目录编排结果。 */
function listedDir(url) {
  const [pathname] = url.split("?");
  return `/${decodeURIComponent(pathname.slice("/api/files/".length))}`;
}

/**
 * 安装 fetch 替身。`listings` 以目录绝对路径为键：给了响应就照发，"throw" 表示断连。
 * Git 状态请求不属于本文件关心的范围，一律返回非仓库结果。
 */
function stubFetch(listings) {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/api/git/status")) return jsonResponse(200, { isGitRepository: false, files: [] });
    const listing = listings[listedDir(url)];
    if (listing === "throw") throw new TypeError("Failed to fetch");
    if (listing) return jsonResponse(listing.status, listing.body);
    return jsonResponse(200, { entries: [] });
  };
  return { calls, restore: () => (globalThis.fetch = previous) };
}

/** 根目录列出四个待测目录，各自按用例编排展开后的结果。 */
function rootListings(overrides) {
  return {
    [CWD]: {
      status: 200,
      body: { entries: DIRS.map((name) => ({ name, isDir: true, size: 0, modified: "" })) },
    },
    ...overrides,
  };
}

/** React 的状态更新与请求回调都排在微任务/宏任务里，等几拍再同步刷新，断言才看得到落地结果。 */
async function settle(rounds = 4) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync(() => {});
  }
}

async function mountExplorer(listings, locale = "en") {
  globalThis.localStorage.setItem("pi-locale", locale);
  const stub = stubFetch(listings);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const element = React.createElement(
    I18nProvider,
    { initialLocale: locale },
    React.createElement(FileExplorer, { cwd: CWD, onOpenFile: () => {}, changesCollapsed: true }),
  );
  flushSync(() => root.render(element));
  await settle();
  return {
    container,
    stub,
    unmount: () => {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
}

/** 按可见名称找到目录行。名称在行内的 span 上，点击事件挂在它的父节点。 */
function rowByName(container, name) {
  const label = [...container.querySelectorAll("span")].find((node) => node.textContent === name);
  return label?.parentElement;
}

async function expand(view, name) {
  const row = rowByName(view.container, name);
  assert.ok(row, `expected a row named ${name}`);
  flushSync(() => row.click());
  await settle();
}

function alerts(container) {
  return [...container.querySelectorAll('[role="alert"]')].map((node) => node.textContent);
}

test("maps a missing permission to the unauthorized message", () => {
  assert.deepEqual(describeFileLoadFailure(403), { key: "files.unauthorized" });
});

test("maps other status codes to a load failure carrying the code", () => {
  assert.deepEqual(describeFileLoadFailure(404), { key: "files.loadFailed", params: { status: 404 } });
  assert.deepEqual(describeFileLoadFailure(500), { key: "files.loadFailed", params: { status: 500 } });
});

test("maps a request without a status code to the network failure message", () => {
  assert.deepEqual(describeFileLoadFailure(null), { key: "files.loadFailedNetwork" });
});

test("an unauthorized directory shows the authorization hint and stays expanded", async () => {
  const view = await mountExplorer(
    rootListings({ [`${CWD}/locked`]: { status: 403, body: { error: "Access denied" } } }),
  );
  try {
    await expand(view, "locked");
    const shown = alerts(view.container);
    assert.equal(shown.length, 1);
    assert.match(shown[0], /not authorized/i);
    assert.doesNotMatch(shown[0], /Access denied/);
    // 节点保持展开：目录行仍在，且没有被写成空目录。
    assert.ok(rowByName(view.container, "locked"), "the directory row stays visible");
    assert.doesNotMatch(view.container.textContent, /No files found/);
  } finally {
    view.unmount();
    view.stub.restore();
  }
});

test("a server error shows the status code instead of the server wording", async () => {
  const view = await mountExplorer(
    rootListings({ [`${CWD}/broken`]: { status: 500, body: { error: "Internal Server Error" } } }),
  );
  try {
    await expand(view, "broken");
    const shown = alerts(view.container);
    assert.equal(shown.length, 1);
    assert.match(shown[0], /500/);
    assert.doesNotMatch(shown[0], /Internal Server Error/);
  } finally {
    view.unmount();
    view.stub.restore();
  }
});

test("a dropped connection still reports a failure", async () => {
  const view = await mountExplorer(rootListings({ [`${CWD}/offline`]: "throw" }));
  try {
    await expand(view, "offline");
    const shown = alerts(view.container);
    assert.equal(shown.length, 1);
    assert.match(shown[0], /network/i);
  } finally {
    view.unmount();
    view.stub.restore();
  }
});

test("an empty directory shows the empty wording and no failure hint", async () => {
  const view = await mountExplorer(rootListings({ [`${CWD}/blank`]: { status: 200, body: { entries: [] } } }));
  try {
    await expand(view, "blank");
    assert.deepEqual(alerts(view.container), []);
    assert.match(view.container.textContent, /No files found/);
  } finally {
    view.unmount();
    view.stub.restore();
  }
});

test("a failing project root uses the same wording as a failing directory", async () => {
  const view = await mountExplorer({ [CWD]: { status: 403, body: { error: "Access denied" } } });
  try {
    const shown = alerts(view.container);
    assert.equal(shown.length, 1);
    assert.match(shown[0], /not authorized/i);
    assert.doesNotMatch(shown[0], /Access denied/);
    assert.doesNotMatch(view.container.textContent, /No files found/);
  } finally {
    view.unmount();
    view.stub.restore();
  }
});

test("the hints follow the interface language", async () => {
  const view = await mountExplorer(
    rootListings({ [`${CWD}/locked`]: { status: 403, body: { error: "Access denied" } } }),
    "zh-CN",
  );
  try {
    await expand(view, "locked");
    assert.match(alerts(view.container)[0], /未被授权访问/);
  } finally {
    view.unmount();
    view.stub.restore();
  }
});

test("both language packs carry every failure and empty key", () => {
  for (const key of ["files.unauthorized", "files.loadFailed", "files.loadFailedNetwork", "files.noFiles"]) {
    assert.ok(enLocale.messages[key]?.trim(), `en ${key}`);
    assert.ok(zhCNLocale.messages[key]?.trim(), `zh-CN ${key}`);
  }
  assert.match(enLocale.messages["files.loadFailed"], /\{status\}/);
  assert.match(zhCNLocale.messages["files.loadFailed"], /\{status\}/);
});
