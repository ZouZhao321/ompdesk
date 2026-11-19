/**
 * 文件树失败目录的重试覆盖：断言用户可见的结果——是否真的又发了一次列表请求、
 * 提示是否消失、内容是否出现。
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

const CWD = "/project";

/** 根目录列出待测目录，各自按用例编排展开后的响应序列。 */
function rootListings(overrides) {
  const names = Object.keys(overrides).map((dir) => dir.slice(dir.lastIndexOf("/") + 1));
  return {
    [CWD]: {
      status: 200,
      body: { entries: names.map((name) => ({ name, isDir: true, size: 0, modified: "" })) },
    },
    ...overrides,
  };
}

const props = { cwd: CWD, onOpenFile: () => {}, changesCollapsed: true };

async function openExplorer(plan) {
  return mountExplorer(FileExplorer, I18nProvider, props, { plan });
}

test("clicking a failed directory requests it again instead of collapsing it", async () => {
  const restore = installDom();
  const view = await openExplorer(rootListings({ [`${CWD}/locked`]: [{ status: 403, body: {} }] }));
  try {
    await clickRow(view.container, "locked");
    assert.equal(alerts(view.container).length, 1);
    const before = view.stub.callsFor(`${CWD}/locked`);

    await clickRow(view.container, "locked");

    assert.ok(view.stub.callsFor(`${CWD}/locked`) > before, "the retry issues another request");
    assert.equal(alerts(view.container).length, 1, "the node stays expanded with its hint");
    assert.ok(rowByName(view.container, "locked"), "the directory row stays visible");
  } finally {
    view.unmount();
    view.stub.restore();
    await restore();
  }
});

test("a successful retry clears the hint and shows the contents", async () => {
  const restore = installDom();
  const view = await openExplorer(
    rootListings({
      [`${CWD}/locked`]: [
        { status: 403, body: {} },
        { status: 200, body: { entries: [{ name: "inside.txt", isDir: false, size: 3, modified: "" }] } },
      ],
    }),
  );
  try {
    await clickRow(view.container, "locked");
    assert.equal(alerts(view.container).length, 1);

    await clickRow(view.container, "locked");

    assert.deepEqual(alerts(view.container), []);
    assert.match(view.container.textContent, /inside\.txt/);
  } finally {
    view.unmount();
    view.stub.restore();
    await restore();
  }
});

test("a retry that fails again keeps a hint", async () => {
  const restore = installDom();
  const view = await openExplorer(
    rootListings({
      [`${CWD}/locked`]: [
        { status: 403, body: {} },
        { status: 500, body: {} },
      ],
    }),
  );
  try {
    await clickRow(view.container, "locked");
    await clickRow(view.container, "locked");
    const shown = alerts(view.container);
    assert.equal(shown.length, 1);
    assert.match(shown[0], /500/);
  } finally {
    view.unmount();
    view.stub.restore();
    await restore();
  }
});

test("refreshing the tree re-requests an expanded failed directory", async () => {
  const restore = installDom();
  const view = await openExplorer(
    rootListings({
      [`${CWD}/locked`]: [
        { status: 403, body: {} },
        { status: 200, body: { entries: [] } },
      ],
    }),
  );
  try {
    await clickRow(view.container, "locked");
    assert.equal(alerts(view.container).length, 1);
    const before = view.stub.callsFor(`${CWD}/locked`);

    view.rerender({ ...props, refreshKey: 1 });
    await settle();

    assert.ok(view.stub.callsFor(`${CWD}/locked`) > before, "the refresh re-requests the failed directory");
    assert.deepEqual(alerts(view.container), []);
  } finally {
    view.unmount();
    view.stub.restore();
    await restore();
  }
});

test("refreshing keeps re-fetching a normally loaded directory", async () => {
  const restore = installDom();
  const view = await openExplorer(
    rootListings({
      [`${CWD}/plain`]: [
        { status: 200, body: { entries: [] } },
        { status: 200, body: { entries: [{ name: "later.txt", isDir: false, size: 1, modified: "" }] } },
      ],
    }),
  );
  try {
    await clickRow(view.container, "plain");
    const before = view.stub.callsFor(`${CWD}/plain`);

    view.rerender({ ...props, refreshKey: 1 });
    await settle();

    assert.ok(view.stub.callsFor(`${CWD}/plain`) > before, "the refresh re-requests the loaded directory");
    assert.match(view.container.textContent, /later\.txt/);
  } finally {
    view.unmount();
    view.stub.restore();
    await restore();
  }
});
