import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { createJiti } from "jiti";
import { installDom, mount, settle } from "./dom-harness.test.mjs";

const VIEWPORT_PROPERTY = "--app-viewport-height";

// 这个 hook 只用模块级常量，可以整体加载一次；DOM 由每个用例自己安装与还原。
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { useViewportHeight } = await jiti.import("./useViewportHeight.ts");

/** 挂一个只调用 hook 的组件，effect 由 React 在挂载后跑完。 */
function mountHook() {
  function Probe() {
    useViewportHeight();
    return createElement("div", null, "viewport");
  }
  return mount(createElement(Probe));
}

/** 把 document.activeElement 指向一个指定标签的可聚焦元素。 */
function focusEditable(handle, tagName, properties = {}) {
  const element = handle.document.createElement(tagName);
  Object.assign(element, properties);
  handle.document.activeElement = element;
  return element;
}

function publishedHeight(handle) {
  return handle.document.documentElement.style.getPropertyValue(VIEWPORT_PROPERTY);
}

test("publishes the keyboard-reduced height while an editable keeps focus", async () => {
  const handle = installDom();
  try {
    handle.installVisualViewport({ height: 510 });
    handle.window.innerHeight = 844;
    focusEditable(handle, "input");

    const view = await mountHook();
    handle.runFrames();

    assert.equal(publishedHeight(handle), "510px");
    assert.equal(handle.window.scrollX, 0);
    await view.unmount();
    assert.equal(publishedHeight(handle), "");
  } finally {
    handle.restore();
  }
});

test("tracks a contentEditable editor and clears the height once focus leaves it", async () => {
  const handle = installDom();
  try {
    handle.installVisualViewport({ height: 420 });
    handle.window.innerHeight = 844;
    focusEditable(handle, "div", { isContentEditable: true });

    const view = await mountHook();
    handle.runFrames();
    assert.equal(publishedHeight(handle), "420px");

    handle.document.activeElement = handle.document.body;
    handle.dispatch("focusout");
    handle.runFrames();

    assert.equal(publishedHeight(handle), "");
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("ignores focus inside elements that do not open a keyboard", async () => {
  const handle = installDom();
  try {
    handle.installVisualViewport({ height: 500 });
    handle.window.innerHeight = 844;
    focusEditable(handle, "div");

    const view = await mountHook();
    handle.runFrames();

    assert.equal(publishedHeight(handle), "");
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("treats a non-element active node as unfocused", async () => {
  const handle = installDom();
  try {
    handle.installVisualViewport({ height: 500 });
    handle.window.innerHeight = 844;
    handle.document.activeElement = { tagName: "INPUT" };

    const view = await mountHook();
    handle.runFrames();

    assert.equal(publishedHeight(handle), "");
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("scrolls the page back when the keyboard shifted it at normal zoom", async () => {
  const handle = installDom();
  try {
    const viewport = handle.installVisualViewport({ height: 600 });
    handle.window.innerHeight = 844;
    focusEditable(handle, "textarea");
    handle.window.scrollY = 120;

    const view = await mountHook();
    handle.runFrames();
    assert.deepEqual(handle.scrollCalls, [[0, 0]]);

    // 缩放后视觉视口滚动是用户自己的操作，不能再抢回滚动位置。
    handle.window.scrollY = 80;
    viewport.scale = 2;
    viewport.dispatchEvent("scroll");
    handle.runFrames();
    assert.equal(handle.scrollCalls.length, 1);
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("coalesces resize and scroll events into one animation frame", async () => {
  const handle = installDom();
  try {
    const viewport = handle.installVisualViewport({ height: 844 });
    handle.window.innerHeight = 844;
    focusEditable(handle, "select");

    const view = await mountHook();
    assert.equal(handle.pendingFrames(), 1);

    viewport.height = 480;
    viewport.dispatchEvent("resize");
    handle.dispatch("resize");
    handle.dispatch("focusin");
    viewport.dispatchEvent("scroll");
    handle.dispatch("pageshow");
    assert.equal(handle.pendingFrames(), 1);

    handle.runFrames();
    assert.equal(publishedHeight(handle), "480px");

    await view.unmount();
    assert.equal(handle.pendingFrames(), 0);
    assert.equal(viewport.listenerCount("resize"), 0);
    assert.equal(viewport.listenerCount("scroll"), 0);
    assert.equal(handle.windowListenerCount("resize"), 0);
    assert.equal(handle.windowListenerCount("focusin"), 0);
    assert.equal(handle.windowListenerCount("focusout"), 0);
    assert.equal(handle.windowListenerCount("pageshow"), 0);
  } finally {
    handle.restore();
  }
});

test("does nothing when the browser has no visual viewport", async () => {
  const handle = installDom();
  try {
    handle.window.innerHeight = 844;
    focusEditable(handle, "input");

    const view = await mountHook();
    await settle();

    assert.equal(handle.pendingFrames(), 0);
    assert.equal(handle.windowListenerCount("resize"), 0);
    assert.equal(publishedHeight(handle), "");
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("cancels a scheduled frame on unmount", async () => {
  const handle = installDom();
  try {
    handle.installVisualViewport({ height: 844 });

    const view = await mountHook();
    assert.equal(handle.pendingFrames(), 1);

    await view.unmount();
    assert.equal(handle.pendingFrames(), 0);
  } finally {
    handle.restore();
  }
});
