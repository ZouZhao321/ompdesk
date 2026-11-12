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
  return jiti.import("./useI18n.tsx");
}

function consumer(seenRef) {
  function Consumer() {
    const context = seenRef.module.useI18n();
    seenRef.current = context;
    return createElement(
      "span",
      null,
      [
        context.locale,
        context.t("common.ok"),
        context.t("updates.availableTitle", { version: "1.2.3" }),
        context.tOr("missing.key", "server fallback"),
        context.supportedLocales.map((plugin) => plugin.id).join(","),
      ].join("|"),
    );
  }
  return createElement(Consumer);
}

test("restores the stored locale and applies it to the document", async () => {
  const handle = installDom();
  try {
    handle.storage.set("pi-locale", "zh-CN");
    handle.window.navigator.languages = ["en-US"];
    const loaded = await loadModule();
    const seen = { module: loaded };
    const view = await mount(createElement(loaded.I18nProvider, null, consumer(seen)));

    assert.equal(seen.current.locale, "zh-CN");
    assert.equal(handle.document.documentElement.lang, "zh-CN");
    assert.equal(seen.current.t("common.ok"), "确定");
    assert.equal(view.container.textContent.startsWith("zh-CN|确定|"), true);
    assert.match(view.container.textContent, /server fallback/);
    assert.equal(seen.current.supportedLocales.map((plugin) => plugin.id).join(","), "en,zh-CN");
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("falls back to the browser language when nothing is stored", async () => {
  const handle = installDom();
  try {
    handle.window.navigator.languages = ["de-DE", "zh-CN", "en"];
    const loaded = await loadModule();
    const seen = { module: loaded };
    const view = await mount(createElement(loaded.I18nProvider, null, consumer(seen)));

    assert.equal(seen.current.locale, "zh-CN");
    assert.equal(handle.document.documentElement.lang, "zh-CN");
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("uses the single browser language when the preferences list is empty", async () => {
  const handle = installDom();
  try {
    handle.window.navigator.languages = [];
    handle.window.navigator.language = "zh-Hant";
    const loaded = await loadModule();
    const seen = { module: loaded };
    const view = await mount(createElement(loaded.I18nProvider, null, consumer(seen)));

    assert.equal(seen.current.locale, "zh-CN");
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("ignores unsupported stored values and keeps a working storage failure path", async () => {
  const handle = installDom();
  try {
    handle.storage.set("pi-locale", "fr");
    handle.window.navigator.languages = ["en-GB"];
    const loaded = await loadModule();
    const seen = { module: loaded };
    const view = await mount(createElement(loaded.I18nProvider, null, consumer(seen)));

    assert.equal(seen.current.locale, "en");
    assert.equal(handle.document.documentElement.lang, "en");
    await view.unmount();

    // 存储在隐私模式下不可用时仍按浏览器语言渲染。
    handle.setStorageError(true);
    handle.window.navigator.languages = ["zh-CN"];
    const isolated = await loadModule();
    const secondSeen = { module: isolated };
    const secondView = await mount(createElement(isolated.I18nProvider, null, consumer(secondSeen)));
    assert.equal(secondSeen.current.locale, "zh-CN");
    await secondView.unmount();
  } finally {
    handle.restore();
  }
});

test("switches locale, persists it, and rejects unregistered locales", async () => {
  const handle = installDom();
  try {
    const loaded = await loadModule();
    const seen = { module: loaded };
    const view = await mount(createElement(loaded.I18nProvider, null, consumer(seen)));
    assert.equal(seen.current.locale, "en");

    seen.current.setLocale("zh-CN");
    await settle();
    assert.equal(seen.current.locale, "zh-CN");
    assert.equal(handle.storage.get("pi-locale"), "zh-CN");
    assert.equal(handle.document.documentElement.lang, "zh-CN");
    assert.equal(seen.current.t("common.ok"), "确定");

    seen.current.setLocale("fr");
    await settle();
    assert.equal(seen.current.locale, "zh-CN");
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("keeps the storage failure from blocking a locale switch", async () => {
  const handle = installDom();
  try {
    const loaded = await loadModule();
    const seen = { module: loaded };
    const view = await mount(createElement(loaded.I18nProvider, null, consumer(seen)));

    handle.setStorageError(true);
    seen.current.setLocale("zh-CN");
    await settle();

    assert.equal(seen.current.locale, "zh-CN");
    assert.equal(handle.document.documentElement.lang, "zh-CN");
    await view.unmount();
  } finally {
    handle.restore();
  }
});

test("server rendering uses the initial locale until hydration reads storage", async () => {
  const handle = installDom();
  try {
    handle.storage.set("pi-locale", "zh-CN");
    const loaded = await loadModule();
    const { renderToStaticMarkup } = await import("react-dom/server");

    const zhMarkup = renderToStaticMarkup(
      createElement(loaded.I18nProvider, { initialLocale: "zh-CN" }, consumer({ module: loaded })),
    );
    const defaultMarkup = renderToStaticMarkup(createElement(loaded.I18nProvider, null, consumer({ module: loaded })));

    assert.equal(zhMarkup.startsWith("<span>zh-CN|确定|"), true);
    assert.equal(defaultMarkup.startsWith("<span>en|OK|"), true);
    assert.equal(handle.document.documentElement.lang, undefined);
  } finally {
    handle.restore();
  }
});

test("using the context outside the provider fails loudly", async () => {
  const handle = installDom();
  try {
    const loaded = await loadModule();
    const { renderToStaticMarkup } = await import("react-dom/server");

    assert.throws(
      () =>
        renderToStaticMarkup(
          createElement(() => {
            loaded.useI18n();
            return null;
          }),
        ),
      /useI18n must be used inside I18nProvider/,
    );
  } finally {
    handle.restore();
  }
});
