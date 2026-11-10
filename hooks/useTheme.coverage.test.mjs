import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createElement } from "react";
import { createJiti } from "jiti";
import { installDom, mount, settle } from "./dom-harness.test.mjs";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const REDUCE_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const CONFIG = {
  names: { dark: "Dark Plus", light: "Light Plus" },
  palettes: {
    dark: { name: "Dark Plus", colorScheme: "dark", variables: { "--omp-bg": "black", "--omp-fg": "white" } },
    light: { name: "Light Plus", colorScheme: "light", variables: { "--omp-bg": "white", "--omp-fg": "black" } },
  },
};

const CACHED_CONFIG = {
  names: { dark: "Cached Dark", light: "Cached Light" },
  palettes: {
    dark: { name: "Cached Dark", colorScheme: "dark", variables: { "--omp-bg": "cached-black" } },
    light: { name: "Cached Light", colorScheme: "light", variables: { "--omp-bg": "cached-white" } },
  },
};

// 主题是一个模块级 store，正对一个页面共享一份主题状态；它绑定的 window/document
// 监听器也只能安装一次。所以整个文件共用同一份 DOM 替身，用例之间靠
// normalizePreference() 把偏好调到目标值，不依赖彼此的收尾状态。
const handle = installDom();
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { refreshOmpTheme, useTheme } = await jiti.import("./useTheme.ts");

after(() => handle.restore());

function themeProbe(useThemeHook, seen, options) {
  function Probe() {
    const state = useThemeHook(options);
    seen.preference = state.preference;
    seen.theme = state.theme;
    seen.isDark = state.isDark;
    seen.toggleTheme = state.toggleTheme;
    return createElement("span", null, `${state.preference}:${state.theme}`);
  }
  return createElement(Probe);
}

async function mountTheme(options) {
  const seen = {};
  const view = await mount(themeProbe(useTheme, seen, options));
  return { seen, view };
}

/** 把共享 store 的偏好调成目标值，最多绕一圈。 */
async function normalizePreference(seen, target) {
  for (let step = 0; step < 3 && seen.preference !== target; step += 1) {
    seen.toggleTheme();
    await settle();
  }
  assert.equal(seen.preference, target, `preference should be normalized to ${target}`);
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

function installTransition() {
  const transitions = [];
  const animations = [];
  handle.document.startViewTransition = (callback) => {
    transitions.push(callback);
    callback();
    return { ready: Promise.resolve() };
  };
  handle.document.documentElement.animate = (keyframes, options) => {
    animations.push({ keyframes, options });
  };
  return { transitions, animations };
}

test("restores the legacy dark key on the first paint", async () => {
  handle.setMedia(DARK_QUERY, false);
  handle.storage.set("omp-theme", "dark");
  const { seen, view } = await mountTheme();

  assert.equal(seen.preference, "dark");
  assert.equal(seen.theme, "dark");
  assert.equal(seen.isDark, true);
  assert.equal(handle.document.documentElement.dataset.ompThemeMode, "dark");
  assert.equal(handle.document.documentElement.classList.contains("dark"), true);
  // 没有加载过主题配置时只切 .dark，并回写旧键给 SSR 引导脚本。
  assert.equal(handle.document.documentElement.dataset.ompThemeName, undefined);
  assert.equal(handle.document.documentElement.style.getPropertyValue("--omp-bg"), "");
  assert.equal(handle.storage.get("omp-theme"), "dark");
  assert.equal(view.container.textContent, "dark:dark");
  await view.unmount();
});

test("keeps working when persisting the preference fails", async () => {
  const { seen, view } = await mountTheme();
  await normalizePreference(seen, "dark");
  handle.setStorageError(true);

  seen.toggleTheme();
  await settle();

  assert.equal(seen.preference, "auto");
  assert.equal(seen.theme, "light");
  assert.equal(handle.document.documentElement.dataset.ompThemeMode, "light");
  handle.setStorageError(false);
  await view.unmount();
});

test("cycles light, dark, and auto, persisting each preference", async () => {
  const { seen, view } = await mountTheme();
  await normalizePreference(seen, "light");

  seen.toggleTheme();
  await settle();
  assert.equal(seen.preference, "dark");
  assert.equal(seen.theme, "dark");
  assert.equal(handle.storage.get("pi-theme"), "dark");

  seen.toggleTheme();
  await settle();
  assert.equal(seen.preference, "auto");
  assert.equal(seen.theme, "light");
  assert.equal(handle.storage.get("pi-theme"), "auto");

  seen.toggleTheme();
  await settle();
  assert.equal(seen.preference, "light");
  assert.equal(handle.storage.get("pi-theme"), "light");
  await view.unmount();
});

test("follows the system scheme while the preference is auto", async () => {
  const { seen, view } = await mountTheme();
  await normalizePreference(seen, "auto");
  assert.equal(seen.theme, "light");

  handle.setMedia(DARK_QUERY, true);
  await settle();
  assert.equal(seen.theme, "dark");
  assert.equal(handle.document.documentElement.dataset.ompThemeMode, "dark");

  // 模拟后台漏掉的方案事件：只改媒体查询结果，不派发 change。
  handle.mediaQuery(DARK_QUERY).matches = false;
  handle.emitVisibility("hidden");
  await settle();
  assert.equal(seen.theme, "dark");

  handle.emitVisibility("visible");
  await settle();
  assert.equal(seen.theme, "light");

  // 窗口重新获得焦点时也同步一次，补上后台错过的方案事件。
  handle.mediaQuery(DARK_QUERY).matches = true;
  handle.dispatch("focus");
  await settle();
  assert.equal(seen.theme, "dark");
  await view.unmount();
});

test("keeps an explicit preference when the system scheme changes", async () => {
  const { seen, view } = await mountTheme();
  await normalizePreference(seen, "light");

  handle.setMedia(DARK_QUERY, true);
  await settle();
  handle.dispatch("focus");
  await settle();

  assert.equal(seen.preference, "light");
  assert.equal(seen.theme, "light");
  assert.equal(handle.document.documentElement.dataset.ompThemeMode, "light");
  await view.unmount();
});

test("skips the view transition when the user asks for reduced motion", async () => {
  const { seen, view } = await mountTheme();
  await normalizePreference(seen, "light");
  const { transitions } = installTransition();
  handle.setMedia(REDUCE_MOTION_QUERY, true);

  seen.toggleTheme({ x: 10, y: 20 });
  await settle();

  assert.equal(transitions.length, 0);
  assert.equal(seen.preference, "dark");
  handle.setMedia(REDUCE_MOTION_QUERY, false);
  await view.unmount();
});

test("reveals the new theme with a view transition from the toggle origin", async () => {
  const { seen, view } = await mountTheme();
  await normalizePreference(seen, "light");
  const { transitions, animations } = installTransition();

  seen.toggleTheme({ x: 10, y: 20 });
  await settle();
  const fromOrigin = Math.hypot(1024 - 10, 800 - 20);
  assert.equal(transitions.length, 1);
  assert.equal(seen.preference, "dark");
  assert.deepEqual(animations[0].keyframes.clipPath, [
    "circle(0px at 10px 20px)",
    `circle(${fromOrigin}px at 10px 20px)`,
  ]);
  assert.equal(animations[0].options.duration, 450);
  assert.equal(animations[0].options.pseudoElement, "::view-transition-new(root)");

  // 没有给出坐标时从视口中心展开。
  seen.toggleTheme();
  await settle();
  const fromCenter = Math.hypot(512, 400);
  assert.deepEqual(animations[1].keyframes.clipPath, [
    "circle(0px at 512px 400px)",
    `circle(${fromCenter}px at 512px 400px)`,
  ]);
  await view.unmount();
});

test("ignores a view transition that the browser cancels", async () => {
  const { seen, view } = await mountTheme();
  await normalizePreference(seen, "light");
  handle.document.startViewTransition = (callback) => {
    callback();
    return { ready: Promise.reject(new Error("cancelled")) };
  };
  handle.document.documentElement.animate = () => {};

  seen.toggleTheme();
  await settle();

  assert.equal(seen.preference, "dark");
  await view.unmount();
});

test("loads the palette from omp and applies its CSS variables", async () => {
  const { seen, view } = await mountTheme();
  await normalizePreference(seen, "dark");
  const requests = [];
  handle.setFetch(async (url, init) => {
    requests.push({ url, init });
    return jsonResponse(CONFIG);
  });

  await refreshOmpTheme("C:/work");

  assert.deepEqual(requests, [{ url: "/api/theme?cwd=C%3A%2Fwork", init: { cache: "no-store" } }]);
  const root = handle.document.documentElement;
  assert.equal(root.style.getPropertyValue("--omp-bg"), "black");
  assert.equal(root.style.getPropertyValue("--omp-fg"), "white");
  assert.equal(root.dataset.ompThemeName, "Dark Plus");
  assert.equal(root.style.colorScheme, "dark");
  assert.equal(root.classList.contains("dark"), true);
  assert.deepEqual(JSON.parse(handle.storage.get("omp-theme-config")), CONFIG);
  await view.unmount();
});

test("reports a failed palette request", async () => {
  handle.setFetch(async () => jsonResponse({}, { ok: false, status: 500 }));

  await assert.rejects(() => refreshOmpTheme(), /Theme request failed \(500\)/);
  await assert.rejects(() => refreshOmpTheme(null), /Theme request failed \(500\)/);
});

test("a slower earlier palette request does not replace the newest one", async () => {
  const { seen, view } = await mountTheme();
  await normalizePreference(seen, "dark");
  const pending = [];
  handle.setFetch(
    () =>
      new Promise((resolve) => {
        pending.push(resolve);
      }),
  );

  const first = refreshOmpTheme(null);
  const second = refreshOmpTheme(null);
  pending[1](jsonResponse(CONFIG));
  await second;
  pending[0](jsonResponse(CACHED_CONFIG));
  await first;

  assert.equal(handle.document.documentElement.style.getPropertyValue("--omp-bg"), "black");
  assert.equal(handle.document.documentElement.dataset.ompThemeName, "Dark Plus");
  assert.deepEqual(JSON.parse(handle.storage.get("omp-theme-config")), CONFIG);
  await view.unmount();
});

test("syncs with omp on mount when asked to", async () => {
  const requests = [];
  handle.setFetch(async (url) => {
    requests.push(url);
    return jsonResponse(CONFIG);
  });

  const { seen, view } = await mountTheme({ cwd: "C:/work", syncWithOmp: true });
  await settle();

  assert.deepEqual(requests, ["/api/theme?cwd=C%3A%2Fwork"]);
  assert.equal(handle.document.documentElement.style.getPropertyValue("--omp-bg"), "black");
  assert.equal(handle.document.documentElement.dataset.ompThemeName, "Dark Plus");
  assert.equal(seen.preference, "dark");
  await view.unmount();
});

test("falls back to the cached palette when omp cannot be reached", async () => {
  handle.storage.set("omp-theme-config", JSON.stringify(CACHED_CONFIG));
  handle.setFetch(async () => jsonResponse({}, { ok: false, status: 502 }));

  const { view } = await mountTheme({ syncWithOmp: true });
  await settle();

  assert.equal(handle.document.documentElement.style.getPropertyValue("--omp-bg"), "cached-black");
  assert.equal(handle.document.documentElement.dataset.ompThemeName, "Cached Dark");
  await view.unmount();
});

test("ignores an unreadable cached palette", async () => {
  // 先在当前文档上落一份可用配置，再让缓存变成无法解析的内容。
  handle.storage.set("omp-theme-config", JSON.stringify(CACHED_CONFIG));
  handle.setFetch(async () => jsonResponse({}, { ok: false, status: 502 }));
  const first = await mountTheme({ syncWithOmp: true });
  await settle();
  assert.equal(handle.document.documentElement.dataset.ompThemeName, "Cached Dark");
  await first.view.unmount();

  handle.storage.set("omp-theme-config", "{ not json");
  handle.setFetch(async () => jsonResponse({}, { ok: false, status: 500 }));
  const second = await mountTheme({ syncWithOmp: true });
  await settle();

  assert.equal(handle.document.documentElement.style.getPropertyValue("--omp-bg"), "cached-black");
  assert.equal(handle.document.documentElement.dataset.ompThemeName, "Cached Dark");
  await second.view.unmount();
});

test("does not touch a cached palette after the view unmounts", async () => {
  let reject;
  handle.setFetch(
    () =>
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise;
      }),
  );
  handle.storage.set("omp-theme-config", JSON.stringify(CONFIG));

  const { view } = await mountTheme({ syncWithOmp: true });
  await view.unmount();
  reject(new Error("offline"));
  await settle();

  // 视图已经卸载，catch 里的兜底不能把 DOM 上的当前主题改掉。
  assert.equal(handle.document.documentElement.dataset.ompThemeName, "Cached Dark");
  assert.equal(handle.document.documentElement.style.getPropertyValue("--omp-bg"), "cached-black");
});

test("server rendering paints the auto/light pair", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const seen = {};

  const markup = renderToStaticMarkup(themeProbe(useTheme, seen));

  assert.equal(markup, "<span>auto:light</span>");
  assert.equal(seen.theme, "light");
});
