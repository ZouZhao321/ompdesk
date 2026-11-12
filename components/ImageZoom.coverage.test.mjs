import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

import { installDom } from "../test-support/dom-harness.mjs";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { ImageZoomSurface, ImagePreviewDialog } = await jiti.import("./ImageZoom.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const { createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { flushSync } = await import("react-dom");

const SRC =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function mountSurface(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      createElement(I18nProvider, null, createElement(ImageZoomSurface, { src: SRC, alt: "fixture", ...props })),
    );
  });
  return {
    container,
    root,
    unmount: () => {
      root.unmount();
      container.remove();
    },
  };
}

function nextFrame() {
  return new Promise((resolve) => setTimeout(resolve, 40));
}

function readout(container) {
  return container.querySelector(".image-zoom-readout").textContent;
}

test("keyboard plus and minus change the zoom readout", async () => {
  const restore = installDom();
  try {
    const view = mountSurface();
    const viewport = view.container.querySelector(".image-zoom-viewport");

    const before = readout(view.container);
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true }));
    await nextFrame();
    const zoomedIn = readout(view.container);
    assert.notEqual(zoomedIn, before, "zoom in changed nothing");

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "-", bubbles: true }));
    await nextFrame();
    assert.notEqual(readout(view.container), zoomedIn, "zoom out changed nothing");

    view.unmount();
  } finally {
    await restore();
  }
});

test("keyboard modifiers are left to the browser", async () => {
  const restore = installDom();
  try {
    const view = mountSurface();
    const viewport = view.container.querySelector(".image-zoom-viewport");
    const before = readout(view.container);

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "+", ctrlKey: true, bubbles: true }));
    await nextFrame();
    assert.equal(readout(view.container), before, "modifier key should not zoom");

    view.unmount();
  } finally {
    await restore();
  }
});

test("zero returns the camera to fit and one returns to actual size", async () => {
  const restore = installDom();
  try {
    const view = mountSurface();
    const viewport = view.container.querySelector(".image-zoom-viewport");

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
    await nextFrame();
    assert.equal(readout(view.container), "100%");

    viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "0", bubbles: true }));
    await nextFrame();
    assert.ok(readout(view.container).endsWith("%"), "fit readout missing");

    view.unmount();
  } finally {
    await restore();
  }
});

test("zoom buttons change the readout and disable at the limits", async () => {
  const restore = installDom();
  try {
    const view = mountSurface();
    const [zoomOut, zoomIn] = view.container.querySelectorAll(".image-zoom-button");

    zoomIn.click();
    await nextFrame();
    const zoomed = readout(view.container);
    assert.notEqual(zoomed, "100%");

    zoomOut.click();
    await nextFrame();
    assert.equal(readout(view.container), "100%");

    view.unmount();
  } finally {
    await restore();
  }
});

test("fit and actual size actions update the active state", async () => {
  const restore = installDom();
  try {
    const view = mountSurface();
    const actions = view.container.querySelectorAll(".image-zoom-action");
    assert.equal(actions.length, 2);

    actions[1].click();
    await nextFrame();
    assert.ok(actions[1].className.includes("is-active"), "actual size should be active at 100%");

    view.unmount();
  } finally {
    await restore();
  }
});

test("double click toggles between fit and 200 percent", async () => {
  const restore = installDom();
  try {
    const view = mountSurface();
    const viewport = view.container.querySelector(".image-zoom-viewport");
    const before = readout(view.container);

    viewport.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 10, clientY: 10 }));
    await nextFrame();
    assert.notEqual(readout(view.container), before, "double click changed nothing");

    viewport.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 10, clientY: 10 }));
    await nextFrame();
    assert.ok(readout(view.container).endsWith("%"));

    view.unmount();
  } finally {
    await restore();
  }
});

test("wheel zoom changes the readout", async () => {
  const restore = installDom();
  try {
    const view = mountSurface();
    const viewport = view.container.querySelector(".image-zoom-viewport");
    const before = readout(view.container);

    viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true, cancelable: true }));
    await nextFrame();
    assert.notEqual(readout(view.container), before, "wheel zoom changed nothing");

    view.unmount();
  } finally {
    await restore();
  }
});

test("pointer drag moves the image transform", async () => {
  const restore = installDom();
  try {
    const view = mountSurface();
    const viewport = view.container.querySelector(".image-zoom-viewport");
    const image = view.container.querySelector("img");
    image.dispatchEvent(new Event("load"));
    const before = image.getAttribute("style");

    viewport.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        clientX: 20,
        clientY: 20,
      }),
    );
    viewport.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerId: 1, pointerType: "mouse", clientX: 50, clientY: 60 }),
    );
    await nextFrame();
    viewport.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, pointerId: 1, pointerType: "mouse", clientX: 50, clientY: 60 }),
    );
    await nextFrame();

    assert.notEqual(image.getAttribute("style"), before, "drag did not move the image");

    view.unmount();
  } finally {
    await restore();
  }
});

test("image load failure shows the error status", async () => {
  const restore = installDom();
  try {
    const view = mountSurface();
    view.container.querySelector("img").dispatchEvent(new Event("error"));
    await nextFrame();
    assert.ok(view.container.querySelector(".image-zoom-status.is-error"), "error status missing");

    view.unmount();
  } finally {
    await restore();
  }
});

test("preview dialog close button calls onClose", async () => {
  const restore = installDom();
  try {
    let closed = 0;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    flushSync(() => {
      root.render(
        createElement(
          I18nProvider,
          null,
          createElement(ImagePreviewDialog, { request: { src: SRC, alt: "预览" }, onClose: () => (closed += 1) }),
        ),
      );
    });

    assert.ok(container.textContent.includes("预览"), "dialog title missing");
    container.querySelector(".image-preview-close").click();
    assert.equal(closed, 1);

    root.unmount();
    container.remove();
  } finally {
    await restore();
  }
});
