import assert from "node:assert/strict";
import test from "node:test";
import { analyzeDistortion } from "./distortion.ts";

function named(path, names) {
  return { path, names: new Set(names) };
}

test("多组结构改造按基准路径排序输出，结论与输入顺序无关", () => {
  const result = analyzeDistortion({
    renames: [],
    // 输入顺序故意按 z、a 给出，输出按基准路径排序。
    deleted: [named("lib/z-old.ts", ["z1", "z2"]), named("lib/a-old.ts", ["a1", "a2"])],
    added: [named("lib/z-new.ts", ["z1", "z2"]), named("lib/a-new.ts", ["a1", "a2"])],
    persistent: [],
    replacements: [],
    baseCoverage: new Map(),
    coverage: new Map(),
  });

  assert.deepEqual(
    result.notes.map((note) => note.file),
    ["lib/a-old.ts → lib/a-new.ts", "lib/z-old.ts → lib/z-new.ts"],
  );
  // 每组都是 1:1 且新路径属于新增文件：git 没识别出改名，按新增文件处理。
  assert.deepEqual(
    result.notes.map((note) => note.label),
    ["改名未识别", "改名未识别"],
  );
  assert.deepEqual(result.exemptions, new Map());
  assert.deepEqual(result.lineFallbacks, []);
});
