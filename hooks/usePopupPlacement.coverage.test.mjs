import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { createJiti } from "jiti";
import { installDom, mount, settle } from "./dom-harness.test.mjs";

const SIZING = { viewportFraction: 0.5, cap: 600, gap: 8, margin: 8, minHeight: 120, prefer: "above" };

async function loadHook() {
  const jiti = createJiti(import.meta.url, {
    alias: { "@": process.cwd() },
    interopDefault: true,
    moduleCache: false,
  });
  return jiti.import("./usePopupPlacement.ts");
}

function anchor(handle, top, bottom) {
  const element = handle.document.createElement("div");
  element.setBoundingRect({ top, bottom, height: bottom - top });
  handle.document.body.appendChild(element);
  return element;
}

function createProbe(usePopupPlacement, anchorRef, open, sizing = SIZING) {
  const seen = { renders: [] };
  function Probe() {
    seen.placement = usePopupPlacement(anchorRef, open, sizing);
    seen.renders.push(seen.placement);
    return createElement("div", null, seen.placement.side);
  }
  return { seen, element: createElement(Probe) };
}

test("keeps the preferred side while the popup is closed", async () => {
  const handle = installDom();
  try {
    const anchorRef = { current: anchor(handle, 100, 140) };
    const { usePopupPlacement } = await loadHook();
    const { seen, element } = createProbe(usePopupPlacement, anchorRef, false);

    const view = await mount(element);

    assert.deepEqual(seen.placement, { side: "above", maxHeight: 600 });
    assert.equal(view.container.textContent, "above");
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("flips below the anchor when there is no room above", async () => {
  const handle = installDom();
  try {
    const anchorRef = { current: anchor(handle, 100, 140) };
    const { usePopupPlacement } = await loadHook();
    const { seen, element } = createProbe(usePopupPlacement, anchorRef, true);

    const view = await mount(element);
    await settle();

    assert.deepEqual(seen.placement, { side: "below", maxHeight: 400 });
    assert.equal(view.container.textContent, "below");
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("flips below when the preferred side has less room than the other", async () => {
  const handle = installDom();
  try {
    const anchorRef = { current: anchor(handle, 300, 340) };
    const { usePopupPlacement } = await loadHook();
    const { seen, element } = createProbe(usePopupPlacement, anchorRef, true);

    const view = await mount(element);

    assert.deepEqual(seen.placement, { side: "below", maxHeight: 400 });
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("honours a preferred side and the minimum height on a cramped viewport", async () => {
  const handle = installDom();
  try {
    const anchorRef = { current: anchor(handle, 660, 700) };
    const { usePopupPlacement } = await loadHook();
    const { seen, element } = createProbe(usePopupPlacement, anchorRef, true, { ...SIZING, prefer: "below" });

    const view = await mount(element);
    assert.deepEqual(seen.placement, { side: "above", maxHeight: 400 });

    handle.window.innerHeight = 200;
    handle.dispatch("resize");
    await settle();
    assert.deepEqual(seen.placement, { side: "above", maxHeight: 120 });
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("measures against the visual viewport when the keyboard shrinks it", async () => {
  const handle = installDom();
  try {
    handle.window.innerHeight = 800;
    handle.installVisualViewport({ height: 500 });
    const anchorRef = { current: anchor(handle, 100, 140) };
    const { usePopupPlacement } = await loadHook();
    const { seen, element } = createProbe(usePopupPlacement, anchorRef, true);

    const view = await mount(element);

    assert.deepEqual(seen.placement, { side: "below", maxHeight: 250 });
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("re-measures when the anchor grows, the window scrolls, or the viewport moves", async () => {
  const handle = installDom();
  try {
    const viewport = handle.installVisualViewport({ height: 800 });
    const element = anchor(handle, 100, 140);
    const anchorRef = { current: element };
    const { usePopupPlacement } = await loadHook();
    const { seen, element: probe } = createProbe(usePopupPlacement, anchorRef, true);

    const view = await mount(probe);
    assert.deepEqual(seen.placement, { side: "below", maxHeight: 400 });
    const placementAfterMount = seen.placement;
    const rendersAfterMount = seen.renders.length;

    // 值没变时保持同一个 placement 对象，避免下游跟着重渲染。
    handle.dispatch("scroll");
    await settle();
    assert.equal(seen.placement, placementAfterMount);

    element.setBoundingRect({ top: 600, bottom: 760 });
    handle.triggerResizeObservers();
    await settle();
    assert.deepEqual(seen.placement, { side: "above", maxHeight: 400 });
    assert.ok(seen.renders.length > rendersAfterMount);

    viewport.height = 780;
    element.setBoundingRect({ top: 700, bottom: 760 });
    viewport.dispatchEvent("resize");
    await settle();
    assert.deepEqual(seen.placement, { side: "above", maxHeight: 390 });

    element.setBoundingRect({ top: 100, bottom: 300 });
    viewport.dispatchEvent("scroll");
    await settle();
    assert.deepEqual(seen.placement, { side: "below", maxHeight: 390 });

    await view.unmount();
    assert.equal(viewport.listenerCount("resize"), 0);
    assert.equal(viewport.listenerCount("scroll"), 0);
  } finally {
    handle.restore();
  }
});

test("keeps the initial placement while the anchor is not mounted", async () => {
  const handle = installDom();
  try {
    const anchorRef = { current: null };
    const { usePopupPlacement } = await loadHook();
    const { seen, element } = createProbe(usePopupPlacement, anchorRef, true);

    const view = await mount(element);

    assert.deepEqual(seen.placement, { side: "above", maxHeight: 600 });
    assert.equal(seen.renders.length, 1);
    // 没有锚点时仍然跟随窗口变化，等锚点挂载后再测量。
    assert.equal(handle.windowListenerCount("resize"), 1);
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("releases the observer and listeners when the popup closes", async () => {
  const handle = installDom();
  try {
    const anchorRef = { current: anchor(handle, 100, 140) };
    const { usePopupPlacement } = await loadHook();
    const { element } = createProbe(usePopupPlacement, anchorRef, true);

    const view = await mount(element);
    assert.equal(handle.observers.length, 1);
    assert.equal(handle.windowListenerCount("resize"), 1);
    assert.equal(handle.windowListenerCount("scroll"), 1);

    await view.unmount();
    assert.equal(handle.observers[0].disconnected, true);
    assert.equal(handle.windowListenerCount("resize"), 0);
    assert.equal(handle.windowListenerCount("scroll"), 0);
  } finally {
    handle.restore();
  }
});
