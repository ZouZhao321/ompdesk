import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { createJiti } from "jiti";
import { installDom, mount, settle } from "./dom-harness.test.mjs";
import { MOBILE_LAYOUT_QUERY } from "../lib/mobile-layout.ts";

const desktopQuery = "(min-width: 1280px)";

function renderProbe(useIsMobile) {
  const seen = {};
  function Probe() {
    seen.mobile = useIsMobile();
    return createElement("span", null, String(seen.mobile));
  }
  return { seen, element: createElement(Probe) };
}

async function loadHook() {
  const jiti = createJiti(import.meta.url, {
    alias: { "@": process.cwd() },
    interopDefault: true,
    moduleCache: false,
  });
  return jiti.import("./useIsMobile.ts");
}

test("reports the mobile layout only when the shared media query matches", async () => {
  const handle = installDom();
  try {
    handle.setMedia(MOBILE_LAYOUT_QUERY, true);
    const { useIsMobile } = await loadHook();
    const { seen, element } = renderProbe(useIsMobile);
    const view = await mount(element);

    assert.equal(seen.mobile, true);
    assert.equal(view.container.textContent, "true");
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("follows the media query while it changes and detaches on unmount", async () => {
  const handle = installDom();
  try {
    const { useIsMobile } = await loadHook();
    const { seen, element } = renderProbe(useIsMobile);
    const view = await mount(element);
    assert.equal(seen.mobile, false);
    assert.equal(handle.mediaQuery(MOBILE_LAYOUT_QUERY).listenerCount(), 1);

    handle.setMedia(MOBILE_LAYOUT_QUERY, true);
    await settle();
    assert.equal(seen.mobile, true);
    assert.equal(view.container.textContent, "true");

    handle.setMedia(MOBILE_LAYOUT_QUERY, false);
    await settle();
    assert.equal(seen.mobile, false);
    assert.equal(view.container.textContent, "false");

    await view.unmount();
    assert.equal(handle.mediaQuery(MOBILE_LAYOUT_QUERY).listenerCount(), 0);
  } finally {
    handle.restore();
  }
});

test("falls back to the desktop layout when the environment has no matchMedia", async () => {
  const handle = installDom();
  try {
    const { useIsMobile } = await loadHook();
    handle.setMedia(MOBILE_LAYOUT_QUERY, true);
    delete handle.window.matchMedia;
    delete globalThis.matchMedia;

    const { seen, element } = renderProbe(useIsMobile);
    const view = await mount(element);

    assert.equal(seen.mobile, false);
    assert.equal(view.container.textContent, "false");
    // 没有媒体查询可订阅时退订回调也必须安全。
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("ignores unrelated media queries", async () => {
  const handle = installDom();
  try {
    const { useIsMobile } = await loadHook();
    const { seen, element } = renderProbe(useIsMobile);
    const view = await mount(element);

    handle.setMedia(desktopQuery, true);
    await settle();

    assert.equal(seen.mobile, false);
    assert.equal(view.container.textContent, "false");
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("server rendering starts from the desktop snapshot", async () => {
  const handle = installDom();
  try {
    const { useIsMobile } = await loadHook();
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { seen, element } = renderProbe(useIsMobile);
    handle.setMedia(MOBILE_LAYOUT_QUERY, true);

    const markup = renderToStaticMarkup(element);

    assert.equal(markup, "<span>false</span>");
    assert.equal(seen.mobile, false);
    assert.equal(handle.mediaQuery(MOBILE_LAYOUT_QUERY).listenerCount(), 0);
  } finally {
    handle.restore();
  }
});
