import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

const settings = await jiti.import("./settings.ts");
const format = await jiti.import("./format.ts");
const enIndex = await jiti.import("./messages/settings/en/index.ts");
const zhIndex = await jiti.import("./messages/settings/zh-CN/index.ts");
const ompSettings = await jiti.import("../omp-settings.ts");

const {
  filterSettingFieldsByQuery,
  groupSlug,
  settingFieldDescriptionKey,
  settingFieldLabelKey,
  settingGroupKey,
  settingTabKey,
} = settings;
const { translateOrFallback } = format;
const { settingsEnParts, settingsEnMessages } = enIndex;
const { settingsZhParts, settingsZhMessages } = zhIndex;
const { SETTING_TABS, TAB_GROUPS, getPathsForTab, getSettingsFieldType } = ompSettings;

const TAB_KEYS = SETTING_TABS.map((tab) => settingTabKey(tab));

test("slugs group names into stable key fragments", () => {
  assert.equal(groupSlug("Status Line"), "status-line");
  assert.equal(groupSlug("Retry & Fallback"), "retry-fallback");
  assert.equal(groupSlug("Rules (TTSR)"), "rules-ttsr");
  assert.equal(groupSlug("规则"), "规则");
  assert.equal(groupSlug("  "), "group");
});

test("builds translation keys from setting identifiers", () => {
  assert.equal(settingTabKey("appearance"), "settings.tab.appearance");
  assert.equal(
    settingGroupKey("appearance", "Status Line"),
    "settings.group.appearance.status-line",
  );
  assert.equal(settingFieldLabelKey("composer.shape"), "settings.field.composer.shape.label");
  assert.equal(
    settingFieldDescriptionKey("composer.shape"),
    "settings.field.composer.shape.description",
  );
});

test("prefers the selected locale, then English, then the server text", () => {
  const messages = {
    en: { "settings.tab.appearance": "Appearance" },
    "zh-CN": { "settings.tab.appearance": "外观" },
  };
  assert.equal(
    translateOrFallback("zh-CN", "settings.tab.appearance", messages, "fallback"),
    "外观",
  );
  assert.equal(
    translateOrFallback("en", "settings.tab.appearance", messages, "fallback"),
    "Appearance",
  );
  assert.equal(
    translateOrFallback("zh-CN", "settings.tab.unknown", messages, "fallback"),
    "fallback",
  );
  assert.equal(translateOrFallback("en", "settings.tab.unknown", messages, "fallback"), "fallback");
});

test("falls back to the server text instead of the key when only English exists", () => {
  const messages = { en: { "settings.field.models.default.label": "Default model" } };
  assert.equal(
    translateOrFallback("zh-CN", "settings.field.models.default.label", messages, "Default model"),
    "Default model",
  );
  assert.equal(
    translateOrFallback("zh-CN", "settings.field.missing.label", messages, "server text"),
    "server text",
  );
});

test("search matches the resolved text for the current language", () => {
  const fields = [
    {
      path: "composer.shape",
      tab: "appearance",
      group: "Composer",
      label: "Composer Shape",
      description: "Visual layout",
    },
    {
      path: "theme.dark",
      tab: "appearance",
      group: "Theme",
      label: "Dark Theme",
      description: "Dark background theme",
    },
  ];
  const zh = {
    "composer.shape": { label: "输入框形状", description: "视觉布局", group: "输入框" },
  };
  const resolve = (field) =>
    zh[field.path] ?? { label: field.label, description: field.description, group: field.group };
  assert.deepEqual(
    filterSettingFieldsByQuery(fields, "输入框", resolve).map((field) => field.path),
    ["composer.shape"],
  );
  assert.deepEqual(
    filterSettingFieldsByQuery(fields, "theme", resolve).map((field) => field.path),
    ["theme.dark"],
  );
  assert.deepEqual(filterSettingFieldsByQuery(fields, "  ", resolve), []);
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

test("every rendered settings field and group is translated", () => {
  for (const tab of SETTING_TABS) {
    const paths = getPathsForTab(tab).filter((path) => getSettingsFieldType(path));
    for (const path of paths) {
      for (const key of [settingFieldLabelKey(path), settingFieldDescriptionKey(path)]) {
        assert.ok(Object.hasOwn(settingsEnMessages, key), `missing English text: ${key}`);
        assert.ok(Object.hasOwn(settingsZhMessages, key), `missing Chinese text: ${key}`);
      }
    }
    for (const group of TAB_GROUPS[tab]) {
      const key = settingGroupKey(tab, group);
      assert.ok(Object.hasOwn(settingsEnMessages, key), `missing English group label: ${key}`);
      assert.ok(Object.hasOwn(settingsZhMessages, key), `missing Chinese group label: ${key}`);
    }
  }
});
