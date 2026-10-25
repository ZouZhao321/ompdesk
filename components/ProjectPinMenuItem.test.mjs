import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ProjectPinMenuItem } = await jiti.import("./ProjectPinMenuItem.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const PIN_LABEL = "Pin to top";
const UNPIN_LABEL = "Unpin project";

/** 返回渲染结果中的 button 起始标签；菜单项只有一个按钮。 */
function buttonTags(html) {
  return html.match(/<button\b[^>]*>/g) ?? [];
}

function renderItem(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ProjectPinMenuItem, { isPinned: false, onToggle() {}, ...overrides }),
    ),
  );
}

test("shows the pin label on a menu button while the project is not pinned", () => {
  const html = renderItem({ isPinned: false });
  const tags = buttonTags(html);

  assert.equal(tags.length, 1, "expected the menu item to render one button");
  assert.ok(html.includes(`>${PIN_LABEL}<`), `expected the visible label "${PIN_LABEL}"`);
  assert.ok(tags[0].includes(`title="${PIN_LABEL}"`), `expected the button title "${PIN_LABEL}"`);
  assert.ok(!html.includes(UNPIN_LABEL), "expected the unpin label to be absent");
});

test("shows the unpin label on a menu button while the project is pinned", () => {
  const html = renderItem({ isPinned: true });
  const tags = buttonTags(html);

  assert.equal(tags.length, 1, "expected the menu item to render one button");
  assert.ok(html.includes(`>${UNPIN_LABEL}<`), `expected the visible label "${UNPIN_LABEL}"`);
  assert.ok(tags[0].includes(`title="${UNPIN_LABEL}"`), `expected the button title "${UNPIN_LABEL}"`);
  assert.ok(!html.includes(PIN_LABEL), "expected the pin label to be absent");
});

test("render does not invoke onToggle or change markup", () => {
  const calls = [];
  const html = renderItem({ isPinned: true, onToggle: () => calls.push("toggle") });

  assert.deepEqual(calls, []);
  assert.equal(html, renderItem({ isPinned: true }));
});
