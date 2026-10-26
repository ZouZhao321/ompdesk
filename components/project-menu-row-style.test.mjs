import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { projectMenuRowStyle } = await jiti.import("./project-menu-row-style.ts");

test("lays out every project menu row the same way", () => {
  const row = projectMenuRowStyle(false);

  assert.equal(row.display, "flex");
  assert.equal(row.alignItems, "center");
  assert.equal(row.gap, 8);
  assert.equal(row.width, "100%");
  assert.equal(row.padding, "0 10px");
  assert.equal(row.fontSize, 11);
});

test("raises project menu rows to the mobile hit target", () => {
  assert.equal(projectMenuRowStyle(true).minHeight, 44);
});

test("keeps the desktop row height unless a denser row asks for its own", () => {
  assert.equal(projectMenuRowStyle(false).minHeight, 34);
  assert.equal(projectMenuRowStyle(false, 28).minHeight, 28);
  assert.equal(projectMenuRowStyle(true, 28).minHeight, 44);
});
