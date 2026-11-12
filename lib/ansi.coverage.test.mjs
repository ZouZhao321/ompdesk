import assert from "node:assert/strict";
import test from "node:test";

const { ansi256Color, parseAnsiLine } = await import("./ansi.ts");

function styleAfter(codes) {
  return parseAnsiLine(`\x1b[${codes}mtext`)[0].style;
}

test("maps the extended 256-color palette and rejects out-of-range indexes", () => {
  assert.equal(ansi256Color(232), "rgb(8, 8, 8)");
  assert.equal(ansi256Color(255), "rgb(238, 238, 238)");
  assert.equal(ansi256Color(196), "rgb(255, 0, 0)");
  assert.equal(ansi256Color(300), undefined);
  assert.equal(ansi256Color(-1), undefined);
});

test("applies truecolor and palette SGR codes to both foreground and background", () => {
  assert.deepEqual(styleAfter("38;2;1;2;3"), { color: "rgb(1, 2, 3)" });
  assert.deepEqual(styleAfter("48;2;4;5;6"), { backgroundColor: "rgb(4, 5, 6)" });
  assert.deepEqual(styleAfter("38;2;1;2"), {}, "an incomplete truecolor triplet sets nothing");
  assert.deepEqual(styleAfter("38;5;196"), { color: "rgb(255, 0, 0)" });
  assert.deepEqual(styleAfter("48;5;232"), { backgroundColor: "rgb(8, 8, 8)" });
  assert.deepEqual(styleAfter("38;5;300"), {}, "an unknown palette index sets nothing");
});

test("toggles and clears every supported text attribute", () => {
  assert.deepEqual(styleAfter("2"), { opacity: 0.65 });
  assert.deepEqual(styleAfter("3"), { fontStyle: "italic" });
  assert.deepEqual(styleAfter("4"), { textDecoration: "underline" });
  assert.deepEqual(styleAfter("1"), { fontWeight: 700 });

  assert.deepEqual(styleAfter("1;2;22"), {});
  assert.deepEqual(styleAfter("3;23"), {});
  assert.deepEqual(styleAfter("4;24"), {});
  assert.deepEqual(styleAfter("31;39"), {});
  assert.deepEqual(styleAfter("41;49"), {});
  assert.deepEqual(styleAfter("31;1;0"), {});
});

test("maps the standard and bright color ranges", () => {
  assert.deepEqual(styleAfter("31"), { color: "#dc2626" });
  assert.deepEqual(styleAfter("91"), { color: "#ef4444" });
  assert.deepEqual(styleAfter("41"), { backgroundColor: "#dc2626" });
  assert.deepEqual(styleAfter("101"), { backgroundColor: "#ef4444" });
  assert.deepEqual(styleAfter("36"), { color: "#0891b2" });
  assert.deepEqual(styleAfter("106"), { backgroundColor: "#06b6d4" });
});
