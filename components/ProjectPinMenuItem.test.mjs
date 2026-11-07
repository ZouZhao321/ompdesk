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

function renderItem(overrides = {}, locale) {
	return renderToStaticMarkup(
		React.createElement(
			I18nProvider,
			{ initialLocale: locale },
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

test("does not claim a pressed state next to a state-changing label", () => {
	for (const isPinned of [false, true]) {
		const [tag] = buttonTags(renderItem({ isPinned }));

		assert.ok(!tag.includes("aria-pressed"), "expected no aria-pressed on the pin toggle");
		assert.ok(!tag.includes("aria-checked"), "expected no aria-checked on the pin toggle");
	}
});

test("shows the localized pin labels in zh-CN", () => {
	const unpinned = renderItem({ isPinned: false }, "zh-CN");
	assert.ok(unpinned.includes(">置顶项目<"), "expected the zh-CN pin label");
	assert.ok(!unpinned.includes(PIN_LABEL), "expected the English pin label to be absent");

	const pinned = renderItem({ isPinned: true }, "zh-CN");
	assert.ok(pinned.includes(">取消置顶<"), "expected the zh-CN unpin label");
	assert.ok(!pinned.includes(UNPIN_LABEL), "expected the English unpin label to be absent");
});
