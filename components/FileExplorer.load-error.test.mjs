/**
 * 文件树目录加载失败的交互覆盖：点目录行后断言用户可见的提示文字。
 *
 * 挂载与请求编排都来自 `test-support/file-tree-harness.mjs`，DOM 环境由
 * `test-support/dom-harness.mjs` 成对注册与还原。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

import { installDom } from "../test-support/dom-harness.mjs";
import { alerts, clickRow, mountExplorer, rowByName, settle } from "../test-support/file-tree-harness.mjs";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { FileExplorer } = await jiti.import("./FileExplorer.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const { enLocale } = await jiti.import("../lib/i18n/messages/en.ts");
const { zhCNLocale } = await jiti.import("../lib/i18n/messages/zh-CN.ts");
const { describeFileLoadFailure, FileListError } = await jiti.import("../lib/file-load-error.ts");

const CWD = "/project";
const DIRS = ["locked", "broken", "offline", "blank"];

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

const props = { cwd: CWD, onOpenFile: () => {}, changesCollapsed: true };

async function openExplorer(plan, locale = "en") {
  return mountExplorer(FileExplorer, I18nProvider, props, { plan, locale });
}

test("maps a missing permission to the unauthorized message", () => {
  assert.deepEqual(describeFileLoadFailure(new FileListError(403)), { key: "files.unauthorized" });
});

test("maps other status codes to a load failure carrying the code", () => {
  assert.deepEqual(describeFileLoadFailure(new FileListError(404)), {
    key: "files.loadFailed",
    params: { status: 404 },
  });
  assert.deepEqual(describeFileLoadFailure(new FileListError(500)), {
    key: "files.loadFailed",
    params: { status: 500 },
  });
});

test("maps a failure without a status code to the network message", () => {
  assert.deepEqual(describeFileLoadFailure(new TypeError("Failed to fetch")), { key: "files.loadFailedNetwork" });
});

test("an unauthorized directory shows the authorization hint and stays expanded", async () => {
  const restore = installDom();
  const view = await openExplorer(
    rootListings({ [`${CWD}/locked`]: { status: 403, body: { error: "Access denied" } } }),
  );
  try {
    await clickRow(view.container, "locked");
    const shown = alerts(view.container);
    assert.equal(shown.length, 1);
    assert.match(shown[0], /not authorized/i);
    assert.doesNotMatch(shown[0], /Access denied/);
    assert.ok(rowByName(view.container, "locked"), "the directory row stays visible");
    assert.doesNotMatch(view.container.textContent, /No files found/);
  } finally {
    view.unmount();
    view.stub.restore();
    await restore();
  }
});

test("a server error shows the status code instead of the server wording", async () => {
  const restore = installDom();
  const view = await openExplorer(
    rootListings({ [`${CWD}/broken`]: { status: 500, body: { error: "Internal Server Error" } } }),
  );
  try {
    await clickRow(view.container, "broken");
    const shown = alerts(view.container);
    assert.equal(shown.length, 1);
    assert.match(shown[0], /500/);
    assert.doesNotMatch(shown[0], /Internal Server Error/);
  } finally {
    view.unmount();
    view.stub.restore();
    await restore();
  }
});

test("a dropped connection still reports a failure", async () => {
  const restore = installDom();
  const view = await openExplorer(rootListings({ [`${CWD}/offline`]: "throw" }));
  try {
    await clickRow(view.container, "offline");
    const shown = alerts(view.container);
    assert.equal(shown.length, 1);
    assert.match(shown[0], /network/i);
  } finally {
    view.unmount();
    view.stub.restore();
    await restore();
  }
});

test("an empty directory shows the empty wording and no failure hint", async () => {
  const restore = installDom();
  const view = await openExplorer(rootListings({ [`${CWD}/blank`]: { status: 200, body: { entries: [] } } }));
  try {
    await clickRow(view.container, "blank");
    assert.deepEqual(alerts(view.container), []);
    assert.match(view.container.textContent, /No files found/);
  } finally {
    view.unmount();
    view.stub.restore();
    await restore();
  }
});

test("a failing project root uses the same wording as a failing directory", async () => {
  const restore = installDom();
  const view = await openExplorer({ [CWD]: { status: 403, body: { error: "Access denied" } } });
  try {
    const shown = alerts(view.container);
    assert.equal(shown.length, 1);
    assert.match(shown[0], /not authorized/i);
    assert.doesNotMatch(shown[0], /Access denied/);
    assert.doesNotMatch(view.container.textContent, /No files found/);
  } finally {
    view.unmount();
    view.stub.restore();
    await restore();
  }
});

test("the hints follow the interface language", async () => {
  const restore = installDom();
  const view = await openExplorer(
    rootListings({ [`${CWD}/locked`]: { status: 403, body: { error: "Access denied" } } }),
    "zh-CN",
  );
  try {
    await clickRow(view.container, "locked");
    assert.match(alerts(view.container)[0], /未被授权访问/);
  } finally {
    view.unmount();
    view.stub.restore();
    await restore();
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

test("a refresh that fails keeps the contents already on screen", async () => {
  const restore = installDom();
  const view = await openExplorer({
    [CWD]: { status: 200, body: { entries: [{ name: "kept", isDir: true, size: 0, modified: "" }] } },
    [`${CWD}/kept`]: [
      { status: 200, body: { entries: [{ name: "inner.txt", isDir: false, size: 2, modified: "" }] } },
      { status: 500, body: {} },
    ],
  });
  try {
    await clickRow(view.container, "kept");
    assert.match(view.container.textContent, /inner\.txt/);

    // 用一次刷新触发的重取：同一目录第二次请求返回 500。
    view.rerender({ ...props, refreshKey: 1 });
    await settle();

    assert.match(view.container.textContent, /inner\.txt/, "the loaded contents are still shown");
    assert.equal(alerts(view.container).length, 1);
  } finally {
    view.unmount();
    view.stub.restore();
    await restore();
  }
});
