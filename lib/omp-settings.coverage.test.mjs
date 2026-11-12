import assert from "node:assert/strict";
import test from "node:test";
import { Settings } from "@oh-my-pi/pi-coding-agent";

const { findSetting, getEnumValues, getSkillsSettings, hasUi } = await import("./omp-settings.ts");

test("resolves a dotted path to its registry handle", () => {
  const setting = findSetting("display.collapseCompacted");
  assert.ok(setting, "expected the display.collapseCompacted handle");
  assert.equal(setting.id, "display.collapseCompacted");
  assert.equal(findSetting("does.not.exist"), undefined);
});

test("reads enum values and UI metadata through the same handles", () => {
  const setting = findSetting("edit.mode");
  assert.ok(setting);
  assert.equal(setting.type, "enum");

  const values = getEnumValues("edit.mode");
  assert.ok(Array.isArray(values));
  assert.ok(values.length > 0);
  assert.equal(getEnumValues("does.not.exist"), undefined);

  assert.equal(hasUi("edit.mode"), setting.ui !== undefined);
  assert.equal(hasUi("does.not.exist"), false);
});

test("reads the aggregate skills settings for a scope", () => {
  const skills = getSkillsSettings(Settings.isolated({}));
  assert.equal(typeof skills, "object");
  assert.equal(typeof skills.enabled, "boolean");
  assert.ok(Array.isArray(skills.customDirectories));
});
