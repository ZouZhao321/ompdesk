import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { isNextDistDirName } = await jiti.import("./build-output.ts");

test("recognises the default output directory", () => {
  assert.equal(isNextDistDirName(".next"), true);
});

test("recognises the per-version output directory", () => {
  assert.equal(isNextDistDirName(".next-v1.0.28"), true);
  assert.equal(isNextDistDirName(".NEXT-V1.0.28"), true);
});

test("leaves project source directories alone", () => {
  assert.equal(isNextDistDirName("lib"), false);
  assert.equal(isNextDistDirName("next-steps"), false);
  assert.equal(isNextDistDirName(".nextjs"), false);
});
