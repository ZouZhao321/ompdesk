import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ProjectRow } = await jiti.import("./ProjectRow.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const { orderProjectPaths, projectDisplayName } = await jiti.import("../lib/project-order.ts");

const PROJECT_PATH = "C:/Users/dev/my-app";
const PIN_MARK_LABEL = "Pinned project";

/** 返回所有带 role="img" 的起始标签，用于区分图钉标记与活动计数徽标。 */
function roleImgTags(html) {
  return html.match(/<[a-zA-Z]+[^>]*role="img"[^>]*>/g) ?? [];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 返回带有指定 aria-label 的 button 起始标签，属性顺序无关。 */
function buttonTag(html, ariaLabel) {
  const pattern = new RegExp(`<button\\b[^>]*aria-label="${escapeRegExp(ariaLabel)}"[^>]*>`);
  const match = html.match(pattern);
  assert.ok(match, `expected a button with aria-label "${ariaLabel}"`);
  return match[0];
}

function ariaExpandedOf(tag) {
  const match = tag.match(/aria-expanded="([^"]*)"/);
  assert.ok(match, `expected aria-expanded on ${tag}`);
  return match[1];
}

/** 把起始标签的 style 属性拆成声明表，用于断言可见性相关的内联样式。 */
function stylesOf(tag) {
  const match = tag.match(/style="([^"]*)"/);
  assert.ok(match, `expected a style attribute on ${tag}`);
  return Object.fromEntries(
    match[1]
      .split(";")
      .filter((declaration) => declaration.includes(":"))
      .map((declaration) => {
        const separator = declaration.indexOf(":");
        return [declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim()];
      }),
  );
}

function renderRow(overrides = {}, locale) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      { initialLocale: locale },
      React.createElement(ProjectRow, {
        project: PROJECT_PATH,
        name: "my-app",
        isSelected: false,
        isCollapsed: false,
        hovered: false,
        menuOpen: false,
        onToggleCollapse() {},
        onSelect() {},
        onNewSession() {},
        onToggleMenu() {},
        onHoverChange() {},
        ...overrides,
      }),
    ),
  );
}

/** 按给定路径顺序渲染一组项目行，置顶集合决定图钉标记。 */
function renderRows(paths, pinned, locale) {
  const rows = paths.map((path) => React.createElement(ProjectRow, {
    key: path,
    project: path,
    name: projectDisplayName(path),
    isSelected: false,
    isCollapsed: false,
    isPinned: pinned.includes(path),
    hovered: false,
    menuOpen: false,
    onToggleCollapse() {},
    onSelect() {},
    onNewSession() {},
    onToggleMenu() {},
    onHoverChange() {},
  }));

  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      { initialLocale: locale },
      React.createElement(React.Fragment, null, ...rows),
    ),
  );
}

test("renders the project name and exposes the full path as the project button title", () => {
  const html = renderRow();

  assert.ok(html.includes(">my-app<"), "expected the project name to be rendered");
  assert.ok(
    html.includes(`title="${PROJECT_PATH}"`),
    "expected the project button title to be the full project path",
  );
});

test("collapse button mirrors isCollapsed through aria-expanded and its label", () => {
  const expandedTag = buttonTag(renderRow({ isCollapsed: false }), "Collapse project");
  assert.equal(ariaExpandedOf(expandedTag), "true");

  const collapsedTag = buttonTag(renderRow({ isCollapsed: true }), "Expand project");
  assert.equal(ariaExpandedOf(collapsedTag), "false");
});

test("renders accessible labels and counts for running, waiting and unread activity", () => {
  const html = renderRow({ activity: { running: 2, waiting: 1, unread: 3 } });

  assert.ok(html.includes('aria-label="Agent running… (2)"'), "expected the running count label");
  assert.ok(html.includes('aria-label="Waiting for your answer (1)"'), "expected the waiting count label");
  assert.ok(html.includes('aria-label="New session activity (3)"'), "expected the unread count label");
});

test("renders exactly one labelled badge per non-zero activity count", () => {
  const html = renderRow({ activity: { running: 2, waiting: 1, unread: 3 } });

  const badges = html.match(/<span\b[^>]*role="img"[^>]*>/g) ?? [];
  assert.equal(badges.length, 3, "expected one badge per non-zero count");

  for (const label of ["Agent running… (2)", "Waiting for your answer (1)", "New session activity (3)"]) {
    assert.ok(
      badges.some((tag) => tag.includes(`aria-label="${label}"`)),
      `expected a badge labelled "${label}"`,
    );
  }
});

test("renders only the activity badges that have a positive count", () => {
  const html = renderRow({ activity: { running: 0, waiting: 0, unread: 2 } });

  assert.ok(html.includes('aria-label="New session activity (2)"'));
  assert.ok(!html.includes("Agent running"), "expected no running badge at zero");
  assert.ok(!html.includes("Waiting for your answer"), "expected no waiting badge at zero");
});

test("renders no activity badges when activity is absent or all zero", () => {
  for (const activity of [undefined, { running: 0, waiting: 0, unread: 0 }]) {
    const html = renderRow({ activity });

    assert.doesNotMatch(html, /role="img"/, "expected no activity badge markup");
    assert.ok(!html.includes("Agent running"), "expected no running badge");
    assert.ok(!html.includes("Waiting for your answer"), "expected no waiting badge");
    assert.ok(!html.includes("New session activity"), "expected no unread badge");
  }
});

test("new-session button label contains the full project path", () => {
  const tag = buttonTag(renderRow(), `New session in ${PROJECT_PATH}`);

  assert.ok(tag.includes(`title="New session in ${PROJECT_PATH}"`));
});

test("actions button mirrors menuOpen through aria-expanded", () => {
  assert.equal(ariaExpandedOf(buttonTag(renderRow({ menuOpen: false }), "Project actions")), "false");
  assert.equal(ariaExpandedOf(buttonTag(renderRow({ menuOpen: true }), "Project actions")), "true");
});

test("shows the new-session button while the row is hovered", () => {
  const tag = buttonTag(renderRow({ hovered: true }), `New session in ${PROJECT_PATH}`);
  const style = stylesOf(tag);

  assert.equal(style.opacity, "1");
  assert.equal(style["pointer-events"], "auto");
});

test("shows the actions button while its menu is open and keeps new-session hidden", () => {
  const html = renderRow({ menuOpen: true });

  const actions = stylesOf(buttonTag(html, "Project actions"));
  assert.equal(actions.opacity, "1", "expected the open menu to keep its trigger visible");
  assert.equal(actions["pointer-events"], "auto");

  const newSession = stylesOf(buttonTag(html, `New session in ${PROJECT_PATH}`));
  assert.equal(newSession.opacity, "0", "expected new-session to stay hidden without hover");
  assert.equal(newSession["pointer-events"], "none");
});

test("hides both row actions when the row is neither hovered nor menu-open", () => {
  const html = renderRow();

  for (const label of [`New session in ${PROJECT_PATH}`, "Project actions"]) {
    const style = stylesOf(buttonTag(html, label));
    assert.equal(style.opacity, "0", `expected "${label}" to be transparent by default`);
    assert.equal(style["pointer-events"], "none", `expected "${label}" to ignore pointers by default`);
  }
});

test("renders children inside the row as the project menu slot", () => {
  const html = renderRow({
    children: React.createElement("div", { "data-testid": "project-menu" }, "menu slot"),
  });

  assert.ok(html.includes('data-testid="project-menu"'), "expected the menu slot to be rendered");
  assert.ok(html.includes("menu slot"));
  assert.ok(
    html.indexOf('data-testid="project-menu"') > html.indexOf(`title="${PROJECT_PATH}"`),
    "expected the menu slot to render inside the project row, after the project button",
  );
});

test("selected styling differs from unselected styling", () => {
  const selected = renderRow({ isSelected: true });
  const unselected = renderRow({ isSelected: false });

  assert.notEqual(selected, unselected);
  assert.ok(selected.includes("var(--bg-hover)"), "expected the selected row to use the hover background token");
  assert.ok(!unselected.includes("var(--bg-hover)"), "expected the unselected row to stay transparent");
});

test("render does not invoke callbacks or change markup", () => {
  const calls = [];
  const html = renderRow({
    onToggleCollapse: () => calls.push("collapse"),
    onSelect: () => calls.push("select"),
    onNewSession: () => calls.push("new-session"),
    onToggleMenu: () => calls.push("menu"),
    onHoverChange: () => calls.push("hover"),
  });

  assert.deepEqual(calls, []);
  assert.equal(html, renderRow());
});

test("renders exactly one pin mark with an accessible name when isPinned is true", () => {
  const html = renderRow({ isPinned: true });
  const marks = roleImgTags(html).filter((tag) => tag.includes(`aria-label="${PIN_MARK_LABEL}"`));

  assert.equal(marks.length, 1, "expected exactly one pin mark");
});

test("renders no pin mark when isPinned is false or absent", () => {
  for (const overrides of [{}, { isPinned: false }]) {
    const html = renderRow(overrides);

    assert.ok(!html.includes(PIN_MARK_LABEL), "expected the pin mark label to be absent");
    assert.deepEqual(roleImgTags(html).filter((tag) => tag.includes("Pin")), [], "expected no pin glyph");
  }
});

test("keeps the activity badges alongside the pin mark", () => {
  const activity = { running: 2, waiting: 1, unread: 3 };
  const pinned = renderRow({ isPinned: true, activity });
  const unpinned = renderRow({ activity });

  assert.equal(roleImgTags(pinned).length, roleImgTags(unpinned).length + 1, "expected the pin mark on top of the badges");
  assert.equal(
    roleImgTags(pinned).filter((tag) => tag.includes(`aria-label="${PIN_MARK_LABEL}"`)).length,
    1,
    "expected the extra mark to be the pin",
  );
  for (const label of ["Agent running… (2)", "Waiting for your answer (1)", "New session activity (3)"]) {
    assert.ok(pinned.includes(`aria-label="${label}"`), `expected the badge labelled "${label}" while pinned`);
  }
});

test("renders the pinned project ahead of the unpinned one in the ordered project list", () => {
  const pinnedProjects = ["/w/beta"];
  const paths = orderProjectPaths(["/w/alpha", "/w/beta"], "name", pinnedProjects);
  assert.deepEqual(paths, ["/w/beta", "/w/alpha"], "expected the pinned project first");

  const html = renderRows(paths, pinnedProjects);
  const pinMarkAt = html.indexOf(`aria-label="${PIN_MARK_LABEL}"`);
  const unpinnedProjectAt = html.indexOf(">alpha<");

  assert.ok(pinMarkAt >= 0, "expected the pin mark to be rendered");
  assert.ok(unpinnedProjectAt >= 0, "expected the unpinned project name to be rendered");
  assert.ok(pinMarkAt < unpinnedProjectAt, "expected the pin mark before the unpinned project");
});

test("renders the localized pin mark label in zh-CN", () => {
  const html = renderRow({ isPinned: true }, "zh-CN");
  const marks = roleImgTags(html).filter((tag) => tag.includes('aria-label="已置顶"'));

  assert.equal(marks.length, 1, "expected exactly one localized pin mark");
  assert.ok(!html.includes(PIN_MARK_LABEL), "expected the English pin label to be absent");
});

test("renders full-width parentheses in the zh-CN activity labels", () => {
  const html = renderRow({ activity: { running: 2, waiting: 0, unread: 3 } }, "zh-CN");

  assert.ok(html.includes('aria-label="Agent 运行中…（2）"'), "expected the localized running count label");
  assert.ok(html.includes('aria-label="会话有新活动（3）"'), "expected the localized unread count label");
});
