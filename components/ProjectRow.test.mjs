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

const PROJECT_PATH = "C:/Users/dev/my-app";

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

function renderRow(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
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
