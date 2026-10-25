import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ProjectSortControl } = await jiti.import("./ProjectSortControl.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const TRIGGER_LABEL = "Sort projects";
const BY_ACTIVITY = "By recent activity";
const BY_NAME = "By name";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 返回带有指定 aria-label 的 button 起始标签，属性顺序无关。 */
function triggerTag(html) {
  const pattern = new RegExp(`<button\\b[^>]*aria-label="${escapeRegExp(TRIGGER_LABEL)}"[^>]*>`);
  const match = html.match(pattern);
  assert.ok(match, `expected a button with aria-label "${TRIGGER_LABEL}"`);
  return match[0];
}

function ariaExpandedOf(tag) {
  const match = tag.match(/aria-expanded="([^"]*)"/);
  assert.ok(match, `expected aria-expanded on ${tag}`);
  return match[1];
}

/** 返回菜单项的完整标签片段，标签可以是 aria-label 或可见文案。 */
function menuItemSnippets(html) {
  const pattern = /<button\b[^>]*\brole="menuitemradio"[^>]*>[\s\S]*?<\/button>/g;
  return html.match(pattern) ?? [];
}

function menuItemFor(html, label) {
  const snippet = menuItemSnippets(html).find(
    (item) => item.includes(label) || item.includes(`aria-label="${label}"`),
  );
  assert.ok(snippet, `expected a menuitemradio labelled "${label}"`);
  return snippet;
}

function ariaCheckedOf(snippet) {
  const match = snippet.match(/aria-checked="([^"]*)"/);
  assert.ok(match, `expected aria-checked on ${snippet}`);
  return match[1];
}

function renderControl(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ProjectSortControl, {
        mode: "time",
        open: false,
        onToggle() {},
        onSelectMode() {},
        ...overrides,
      }),
    ),
  );
}

test("keeps the menu closed when open is false", () => {
  const html = renderControl({ open: false });

  assert.equal(ariaExpandedOf(triggerTag(html)), "false");
  assert.deepEqual(menuItemSnippets(html), []);
  assert.ok(!html.includes(BY_ACTIVITY), "expected no recent-activity option while closed");
  assert.ok(!html.includes(BY_NAME), "expected no name option while closed");
});

test("marks the trigger expanded when the menu is open", () => {
  assert.equal(ariaExpandedOf(triggerTag(renderControl({ open: true }))), "true");
});

test("renders exactly the two sort options when open", () => {
  const html = renderControl({ open: true });

  assert.equal(menuItemSnippets(html).length, 2, "expected one menu item per sort mode");
  menuItemFor(html, BY_ACTIVITY);
  menuItemFor(html, BY_NAME);
});

test("checks the recent-activity option when the mode is time", () => {
  const html = renderControl({ open: true, mode: "time" });

  assert.equal(ariaCheckedOf(menuItemFor(html, BY_ACTIVITY)), "true");
  assert.equal(ariaCheckedOf(menuItemFor(html, BY_NAME)), "false");
});

test("checks the name option when the mode is name", () => {
  const html = renderControl({ open: true, mode: "name" });

  assert.equal(ariaCheckedOf(menuItemFor(html, BY_ACTIVITY)), "false");
  assert.equal(ariaCheckedOf(menuItemFor(html, BY_NAME)), "true");
});

test("render does not invoke callbacks or change markup", () => {
  const calls = [];
  const html = renderControl({
    open: true,
    mode: "name",
    onToggle: () => calls.push("toggle"),
    onSelectMode: (mode) => calls.push(`select:${mode}`),
  });

  assert.deepEqual(calls, []);
  assert.equal(html, renderControl({ open: true, mode: "name" }));
});
