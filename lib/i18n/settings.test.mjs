import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

const settings = await jiti.import("./settings.ts");
const enIndex = await jiti.import("./messages/settings/en/index.ts");
const zhIndex = await jiti.import("./messages/settings/zh-CN/index.ts");
const ompSettings = await jiti.import("../omp-settings.ts");

const { groupSlug, resolveSettingText, settingFieldDescriptionKey, settingFieldLabelKey, settingGroupKey, settingTabKey } = settings;
const { settingsEnParts, settingsEnMessages } = enIndex;
const { settingsZhParts, settingsZhMessages } = zhIndex;
const { SETTING_TABS, TAB_GROUPS, getPathsForTab, getSettingsFieldType } = ompSettings;

const TAB_KEYS = SETTING_TABS.map((tab) => settingTabKey(tab));

test("slugs group names into stable key fragments", () => {
  assert.equal(groupSlug("Status Line"), "status-line");
  assert.equal(groupSlug("Retry & Fallback"), "retry-fallback");
  assert.equal(groupSlug("Rules (TTSR)"), "rules-ttsr");
  assert.equal(groupSlug("  "), "general");
});

test("builds translation keys from setting identifiers", () => {
  assert.equal(settingTabKey("appearance"), "settings.tab.appearance");
  assert.equal(settingGroupKey("appearance", "Status Line"), "settings.group.appearance.status-line");
  assert.equal(settingFieldLabelKey("composer.shape"), "settings.field.composer.shape.label");
  assert.equal(settingFieldDescriptionKey("composer.shape"), "settings.field.composer.shape.description");
});

test("prefers the selected locale, then English, then the server text", () => {
  const messages = { en: { "settings.tab.appearance": "Appearance" }, "zh-CN": { "settings.tab.appearance": "外观" } };
  assert.equal(resolveSettingText("zh-CN", "settings.tab.appearance", messages, "fallback"), "外观");
  assert.equal(resolveSettingText("en", "settings.tab.appearance", messages, "fallback"), "Appearance");
  assert.equal(resolveSettingText("zh-CN", "settings.tab.unknown", messages, "fallback"), "fallback");
});

test("each language package has a single owner for every settings key", () => {
  for (const parts of [settingsEnParts, settingsZhParts]) {
    const seen = new Set();
    for (const [name, messages] of Object.entries(parts)) {
      for (const key of Object.keys(messages)) {
        assert.equal(seen.has(key), false, `${key} is defined in more than one part (${name})`);
        seen.add(key);
      }
    }
  }
});

test("English and Chinese settings packages expose the same keys", () => {
  const enKeys = Object.keys(settingsEnMessages).sort();
  const zhKeys = Object.keys(settingsZhMessages).sort();
  assert.deepEqual(zhKeys, enKeys);
});

test("every settings tab has a localized label", () => {
  for (const key of TAB_KEYS) {
    assert.ok(settingsEnMessages[key], `missing English tab label: ${key}`);
    assert.ok(settingsZhMessages[key], `missing Chinese tab label: ${key}`);
  }
});

test("a started settings tab is fully translated", () => {
  for (const tab of SETTING_TABS) {
    const paths = getPathsForTab(tab).filter((path) => getSettingsFieldType(path));
    const started = paths.some((path) => Object.hasOwn(settingsZhMessages, settingFieldLabelKey(path)));
    if (!started) continue;

    for (const path of paths) {
      for (const key of [settingFieldLabelKey(path), settingFieldDescriptionKey(path)]) {
        assert.ok(Object.hasOwn(settingsEnMessages, key), `missing English text: ${key}`);
        assert.ok(Object.hasOwn(settingsZhMessages, key), `missing Chinese text: ${key}`);
      }
    }
    for (const group of TAB_GROUPS[tab]) {
      const key = settingGroupKey(tab, group);
      assert.ok(Object.hasOwn(settingsZhMessages, key), `missing Chinese group label: ${key}`);
    }
  }
});
