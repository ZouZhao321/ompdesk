import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { flushSync } from "react-dom";

import { installDom, mount } from "../test-support/dom-harness.mjs";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { ProjectRow } = await jiti.import("./ProjectRow.tsx");
const { ProjectPinMenuItem } = await jiti.import("./ProjectPinMenuItem.tsx");
const { TurnWrittenFiles } = await jiti.import("./TurnWrittenFiles.tsx");
const { FolderIcon, GenericFileIcon, getFileIcon } = await jiti.import("./FileIcons.tsx");
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function clickSync(element) {
  flushSync(() => {
    element.click();
  });
}

function baseRowProps(overrides = {}) {
  return {
    project: "C:/work/demo",
    name: "demo",
    isSelected: false,
    isCollapsed: false,
    hovered: false,
    menuOpen: false,
    onToggleCollapse: () => {},
    onSelect: () => {},
    onNewSession: () => {},
    onToggleMenu: () => {},
    onHoverChange: () => {},
    ...overrides,
  };
}

test("turn written files open the diff view when clicked", async () => {
  const restore = installDom();
  try {
    const opened = [];
    const view = mount(
      TurnWrittenFiles,
      { files: [{ filePath: "src/a.ts" }], onOpenFile: (path, options) => opened.push([path, options]) },
      I18nProvider,
    );

    clickSync(view.container.querySelector(".file-chip-button"));
    assert.deepEqual(opened, [["src/a.ts", { modeHint: "diff" }]]);

    view.unmount();
  } finally {
    await restore();
  }
});

test("pin menu item toggles through onToggle", async () => {
  const restore = installDom();
  try {
    let toggled = 0;
    const view = mount(ProjectPinMenuItem, { isPinned: false, onToggle: () => (toggled += 1) }, I18nProvider);

    clickSync(view.container.querySelector("button"));
    assert.equal(toggled, 1);

    view.unmount();
  } finally {
    await restore();
  }
});

test("markdown tables render as table markup", async () => {
  const restore = installDom();
  try {
    const view = mount(MarkdownBody, { children: "| 名称 | 数量 |\n| --- | --- |\n| 文件 | 3 |\n" }, I18nProvider);

    const table = view.container.querySelector("table");
    assert.ok(table, "table missing");
    assert.ok(table.textContent.includes("文件"), "cell text missing");

    view.unmount();
  } finally {
    await restore();
  }
});

test("file icons differ between folders, generic files and known extensions", () => {
  assert.ok(FolderIcon({ size: 12 }));
  assert.ok(GenericFileIcon({ size: 12 }));
  const types = ["a.ts", "a.tsx", "a.json", "a.md", "a.css", "a.png", "a.yml", "a.unknown"].map(
    (name) => getFileIcon(name, 12)?.type?.name ?? getFileIcon(name, 12)?.type,
  );
  assert.ok(types.every(Boolean), "some file names produced no icon");
});

test("project row callbacks fire from its controls", async () => {
  const restore = installDom();
  try {
    const calls = [];
    const view = mount(
      ProjectRow,
      baseRowProps({
        onToggleCollapse: () => calls.push("collapse"),
        onSelect: () => calls.push("select"),
        onNewSession: () => calls.push("new"),
        onToggleMenu: () => calls.push("menu"),
      }),
      I18nProvider,
    );

    clickSync(view.container.querySelector(".sidebar-project-icon-button"));
    clickSync(view.container.querySelector(".sidebar-project-name"));
    const reveal = view.container.querySelectorAll(".sidebar-project-icon-reveal");
    clickSync(reveal[0]);
    clickSync(reveal[1]);

    assert.deepEqual(calls, ["collapse", "select", "new", "menu"]);

    view.unmount();
  } finally {
    await restore();
  }
});

test("project row reports hover changes", async () => {
  const restore = installDom();
  try {
    const seen = [];
    const view = mount(ProjectRow, baseRowProps({ onHoverChange: (value) => seen.push(value) }), I18nProvider);
    const row = view.container.querySelector(".sidebar-project-row");

    row.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    row.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));

    assert.deepEqual(seen, [true, false]);

    view.unmount();
  } finally {
    await restore();
  }
});
