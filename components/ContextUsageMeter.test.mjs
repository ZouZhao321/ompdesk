import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
	jsx: { runtime: "automatic" },
	tsconfigPaths: true,
});
const { ContextUsageMeter } = await jiti.import("./ChatInput.tsx");

const t = (key) => key;
const render = (usage) => renderToStaticMarkup(React.createElement(ContextUsageMeter, { usage, t }));

const readArcs = (html) => {
	const circles = [...html.matchAll(/<circle[^>]*>/g)].map((m) => m[0]);
	return circles.map((tag) => ({
		stroke: /stroke="([^"]*)"/.exec(tag)?.[1],
		dashoffset: Number(/stroke-dashoffset="([^"]*)"/.exec(tag)?.[1]),
		dasharray: Number(/stroke-dasharray="([^"]*)"/.exec(tag)?.[1]),
	}));
};

test("renders nothing before the session has any tokens", () => {
	assert.equal(render(null), "");
	assert.equal(render(undefined), "");
	assert.equal(render({ tokens: 0, contextWindow: 200000 }), "");
});

test("draws a ring whose arc matches the used share", () => {
	const html = render({ tokens: 50000, contextWindow: 100000 });
	assert.match(html, /<svg/);
	const [, progress] = readArcs(html);
	assert.ok(progress.dasharray > 0);
	const expected = progress.dasharray * 0.5;
	assert.ok(Math.abs(progress.dashoffset - expected) < 1e-6, `dashoffset ${progress.dashoffset} != ${expected}`);
	assert.equal(progress.stroke, "var(--text-muted)");
});

test("keeps the warning and critical thresholds", () => {
	const warning = readArcs(render({ tokens: 75000, contextWindow: 100000 }))[1];
	const critical = readArcs(render({ tokens: 95000, contextWindow: 100000 }))[1];
	assert.equal(warning.stroke, "#eab308");
	assert.equal(critical.stroke, "#ef4444");
});

test("keeps the tabular labels next to the ring", () => {
	const html = render({ tokens: 50000, contextWindow: 100000 });
	assert.match(html, /50%/);
	assert.match(html, /50k/);
	assert.match(html, /100k/);
});
