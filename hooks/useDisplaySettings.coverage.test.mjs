import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { createJiti } from "jiti";
import { installDom, mount, settle } from "./dom-harness.test.mjs";

async function loadModule() {
  const jiti = createJiti(import.meta.url, {
    alias: { "@": process.cwd() },
    interopDefault: true,
    moduleCache: false,
  });
  return jiti.import("./useDisplaySettings.ts");
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

function probeFor(useSyncedDisplaySettings, cwd, seen) {
  seen.renders = 0;
  function Probe() {
    const settings = useSyncedDisplaySettings(cwd);
    seen.hideThinkingBlock = settings.hideThinkingBlock;
    seen.renders += 1;
    return createElement("span", null, String(settings.hideThinkingBlock));
  }
  return createElement(Probe);
}

test("fetches the render-affecting settings for the requested cwd and applies them", async () => {
  const handle = installDom();
  try {
    const requests = [];
    handle.setFetch(async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({ hideThinkingBlock: true });
    });
    const { useSyncedDisplaySettings } = await loadModule();
    const seen = {};

    const view = await mount(probeFor(useSyncedDisplaySettings, "C:/work", seen));

    assert.deepEqual(requests, [{ url: "/api/display-settings?cwd=C%3A%2Fwork", init: { cache: "no-store" } }]);
    assert.equal(seen.hideThinkingBlock, true);
    assert.equal(view.container.textContent, "true");
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("omits the query string when no cwd is given", async () => {
  const handle = installDom();
  try {
    const requests = [];
    handle.setFetch(async (url) => {
      requests.push(url);
      return jsonResponse({ hideThinkingBlock: true });
    });
    const { refreshDisplaySettings, useDisplaySettings } = await loadModule();

    await refreshDisplaySettings();
    await refreshDisplaySettings(null);

    assert.deepEqual(requests, ["/api/display-settings", "/api/display-settings"]);

    const seen = {};
    function Probe() {
      seen.settings = useDisplaySettings();
      return createElement("span", null, String(seen.settings.hideThinkingBlock));
    }
    const view = await mount(createElement(Probe));
    assert.equal(seen.settings.hideThinkingBlock, true);
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("reports the HTTP failure but keeps the last cosmetic values", async () => {
  const handle = installDom();
  try {
    let respond = () => jsonResponse({ hideThinkingBlock: true });
    handle.setFetch(async () => respond());
    const { refreshDisplaySettings, useSyncedDisplaySettings } = await loadModule();

    await refreshDisplaySettings(null);
    respond = () => jsonResponse({}, { ok: false, status: 503 });
    await assert.rejects(() => refreshDisplaySettings(null), /Display settings request failed \(503\)/);

    const seen = {};
    const view = await mount(probeFor(useSyncedDisplaySettings, null, seen));
    assert.equal(seen.hideThinkingBlock, true);
    assert.equal(view.container.textContent, "true");
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("a slower earlier response cannot overwrite a newer answer", async () => {
  const handle = installDom();
  try {
    const pending = [];
    handle.setFetch(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    const { refreshDisplaySettings, useDisplaySettings } = await loadModule();

    const first = refreshDisplaySettings("C:/first");
    const second = refreshDisplaySettings("C:/second");
    assert.equal(pending.length, 2);

    pending[1](jsonResponse({ hideThinkingBlock: false }));
    await second;
    pending[0](jsonResponse({ hideThinkingBlock: true }));
    await first;

    const seen = {};
    function Probe() {
      seen.hideThinkingBlock = useDisplaySettings().hideThinkingBlock;
      return createElement("span", null, String(seen.hideThinkingBlock));
    }
    const view = await mount(createElement(Probe));
    assert.equal(seen.hideThinkingBlock, false);
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("does not notify consumers when the value did not change", async () => {
  const handle = installDom();
  try {
    handle.setFetch(async () => jsonResponse({ hideThinkingBlock: true }));
    const { refreshDisplaySettings, useSyncedDisplaySettings } = await loadModule();
    const seen = {};

    const view = await mount(probeFor(useSyncedDisplaySettings, null, seen));
    const rendersAfterMount = seen.renders;

    await refreshDisplaySettings(null);
    await settle();

    assert.equal(seen.renders, rendersAfterMount);
    assert.equal(seen.hideThinkingBlock, true);
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("refetches when the view switches cwd", async () => {
  const handle = installDom();
  try {
    const requests = [];
    handle.setFetch(async (url) => {
      requests.push(url);
      return jsonResponse({ hideThinkingBlock: url.includes("C%3A%2Fb") });
    });
    const { useSyncedDisplaySettings } = await loadModule();
    const seen = {};

    const view = await mount(probeFor(useSyncedDisplaySettings, "C:/a", seen));
    assert.equal(seen.hideThinkingBlock, false);

    await view.rerender(probeFor(useSyncedDisplaySettings, "C:/b", seen));

    assert.equal(requests.at(-1), "/api/display-settings?cwd=C%3A%2Fb");
    assert.equal(seen.hideThinkingBlock, true);
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("server rendering reads the built-in defaults", async () => {
  const handle = installDom();
  try {
    const { useDisplaySettings } = await loadModule();
    const { renderToStaticMarkup } = await import("react-dom/server");
    function Probe() {
      return createElement("span", null, String(useDisplaySettings().hideThinkingBlock));
    }

    assert.equal(renderToStaticMarkup(createElement(Probe)), "<span>false</span>");
  } finally {
    handle.restore();
  }
});
