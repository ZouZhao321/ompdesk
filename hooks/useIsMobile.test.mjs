import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { isMobileLayout } = await jiti.import("./useIsMobile.ts");

const cases = [
  { name: "portrait phone with a fine pointer", width: 390, height: 844, coarsePointer: false, mobile: true },
  { name: "landscape phone with a coarse pointer", width: 844, height: 390, coarsePointer: true, mobile: true },
  { name: "landscape window with a fine pointer", width: 844, height: 390, coarsePointer: false, mobile: false },
  { name: "tablet at the width breakpoint", width: 768, height: 1024, coarsePointer: false, mobile: true },
  { name: "desktop just past the width breakpoint", width: 769, height: 1024, coarsePointer: false, mobile: false },
  { name: "wide desktop", width: 1440, height: 900, coarsePointer: false, mobile: false },
];

for (const { name, width, height, coarsePointer, mobile } of cases) {
  test(`${name} (${width}x${height}) resolves to the ${mobile ? "mobile" : "desktop"} layout`, () => {
    assert.equal(isMobileLayout({ width, height, coarsePointer }), mobile);
  });
}
