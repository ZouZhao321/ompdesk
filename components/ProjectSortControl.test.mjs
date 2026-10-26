import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ProjectSortControl, sortMenuKeyAction } = await jiti.import("./ProjectSortControl.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

// 静态渲染不会触发事件处理函数，关闭路径的接线直接读源码断言。
const source = readFileSync(new URL("./ProjectSortControl.tsx", import.meta.url), "utf8");

const TRIGGER_LABEL = "Sort projects";
const BY_ACTIVITY = "By recent activity";
const BY_NAME = "By name";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 返回带有指定 aria-label 的 button 起始标签，属性顺序无关。 */
function triggerTag(html, label = TRIGGER_LABEL) {
  const pattern = new RegExp(`<button\\b[^>]*aria-label="${escapeRegExp(label)}"[^>]*>`);
  const match = html.match(pattern);
  assert.ok(match, `expected a button with aria-label "${label}"`);
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

function renderControl(overrides = {}, locale) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      { initialLocale: locale },
      React.createElement(ProjectSortControl, {
        mode: "time",
        open: false,
        onToggle() {},
        onDismiss() {},
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
    onDismiss: () => calls.push("dismiss"),
    onSelectMode: (mode) => calls.push(`select:${mode}`),
  });

  assert.deepEqual(calls, []);
  assert.equal(html, renderControl({ open: true, mode: "name" }));
});

test("wraps the open menu items in a menu container", () => {
  const html = renderControl({ open: true });

  assert.match(html, /<div\b[^>]*\brole="menu"/, "expected a menu container around the menu items");
  assert.ok(
    html.indexOf('role="menu"') < html.indexOf('role="menuitemradio"'),
    "expected the menu container to open before the menu items",
  );
});

test("keeps the sort options out of the tab order so Tab leaves the control", () => {
  const html = renderControl({ open: true });

  for (const snippet of menuItemSnippets(html)) {
    assert.ok(snippet.includes('tabindex="-1"'), `expected a roving-focus menu item, got ${snippet}`);
  }
});

test("renders the menu labels in zh-CN", () => {
  const html = renderControl({ open: true, mode: "name" }, "zh-CN");

  assert.ok(triggerTag(html, "项目排序").includes('aria-label="项目排序"'), "expected the localized trigger label");
  assert.equal(menuItemSnippets(html).length, 2, "expected one menu item per sort mode");
  assert.equal(ariaCheckedOf(menuItemFor(html, "按最近活动")), "false");
  assert.equal(ariaCheckedOf(menuItemFor(html, "按名称")), "true");
});

// 键盘映射是菜单导航的唯一决策点：组件只负责把结果落到焦点与开关上。
const focusAction = (index) => ({ kind: "focus", index });

test("moves focus down and up through the sort options with wrapping", () => {
  assert.deepEqual(sortMenuKeyAction("ArrowDown", 0, 2), focusAction(1));
  assert.deepEqual(sortMenuKeyAction("ArrowDown", 1, 2), focusAction(0));
  assert.deepEqual(sortMenuKeyAction("ArrowUp", 1, 2), focusAction(0));
  assert.deepEqual(sortMenuKeyAction("ArrowUp", 0, 2), focusAction(1));
});

test("enters the sort menu at the first or last option when no item is focused", () => {
  assert.deepEqual(sortMenuKeyAction("ArrowDown", -1, 2), focusAction(0));
  assert.deepEqual(sortMenuKeyAction("ArrowUp", -1, 2), focusAction(1));
});

test("jumps to the first and last sort option with Home and End", () => {
  assert.deepEqual(sortMenuKeyAction("Home", 1, 2), focusAction(0));
  assert.deepEqual(sortMenuKeyAction("End", 0, 2), focusAction(1));
});

test("closes the sort menu on Escape and hands focus back to the trigger", () => {
  assert.deepEqual(sortMenuKeyAction("Escape", 0, 2), { kind: "close" });
  assert.deepEqual(sortMenuKeyAction("Escape", 1, 2), { kind: "close" });
});

test("leaves Tab to the browser so focus moves out of the menu instead of closing it", () => {
  assert.equal(sortMenuKeyAction("Tab", 0, 2), null);
  assert.equal(sortMenuKeyAction("Tab", 1, 2), null);
});

test("leaves unrelated keys and an empty menu to the browser", () => {
  for (const key of ["Enter", " ", "a", "PageDown"]) {
    assert.equal(sortMenuKeyAction(key, 0, 2), null, `expected "${key}" to keep the default behavior`);
  }
  assert.equal(sortMenuKeyAction("ArrowDown", -1, 0), null);
  assert.equal(sortMenuKeyAction("Escape", -1, 0), null);
});

/** 返回组件里某个 useCallback 回调的源码，用来断言关闭路径的接线。 */
function callbackBody(name) {
  const start = source.indexOf(`const ${name} = useCallback`);
  assert.ok(start >= 0, `expected a ${name} callback`);
  const end = source.indexOf("}, [", start);
  assert.ok(end > start, `expected ${name} to end with a dependency list`);
  return source.slice(start, end);
}

test("closes the menu through onDismiss on every close path", () => {
  for (const name of ["handleMenuKeyDown", "selectMode", "handleBlur"]) {
    assert.match(callbackBody(name), /onDismiss\(\);/, `expected ${name} to close through onDismiss`);
    assert.doesNotMatch(callbackBody(name), /onToggle\(/, `expected ${name} to leave toggling to the trigger`);
  }
});

test("selects the mode before closing the menu", () => {
  const body = callbackBody("selectMode");

  assert.ok(
    body.indexOf("onSelectMode(option)") < body.indexOf("onDismiss()"),
    "expected the selection to land before the menu closes",
  );
});

test("uses onToggle only for the trigger button", () => {
  assert.match(source, /onClick=\{onToggle\}/, "expected the trigger button to toggle the menu");
  assert.equal(
    source.match(/onToggle/g).length,
    3,
    "expected onToggle in the props interface, the destructuring and the trigger click only",
  );
});
