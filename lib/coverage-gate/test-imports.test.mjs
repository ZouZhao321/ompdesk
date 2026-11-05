import assert from "node:assert/strict";
import test from "node:test";
import { collectTestImports, isImportedByTest } from "./test-imports.ts";

function importsOf(filePath, sourceText) {
  return collectTestImports(new Map([[filePath, sourceText]]));
}

test("具名导入按被导入文件归并，路径按扩展名候选解析", () => {
  const index = importsOf("lib/a.test.ts", 'import { foo } from "./a";\nfoo();\n');

  assert.equal(isImportedByTest(index, "lib/a.ts", "foo"), true);
  assert.equal(isImportedByTest(index, "lib/a.ts", "bar"), false);
});

test("带扩展名的相对路径与上一级目录都能解析", () => {
  const index = importsOf(
    "lib/rules/b.test.mjs",
    'import { one } from "../a.ts";\nimport { two } from "../deep/c";\n',
  );

  assert.equal(isImportedByTest(index, "lib/a.ts", "one"), true);
  assert.equal(isImportedByTest(index, "lib/deep/c.ts", "two"), true);
});

test("别名导入记的是被导入的符号名", () => {
  const index = importsOf("lib/a.test.ts", 'import { foo as renamed } from "./a";\n');

  assert.equal(isImportedByTest(index, "lib/a.ts", "foo"), true);
  assert.equal(isImportedByTest(index, "lib/a.ts", "renamed"), false);
});

test("命名空间导入视为导入了该模块的全部符号", () => {
  const index = importsOf("lib/a.test.ts", 'import * as api from "./a";\napi.anyName();\n');

  assert.equal(isImportedByTest(index, "lib/a.ts", "anyName"), true);
});

test("纯类型导入不算被动覆盖", () => {
  const index = importsOf("lib/a.test.ts", 'import type { Shape } from "./a";\n');

  assert.equal(isImportedByTest(index, "lib/a.ts", "Shape"), false);
});

test("包名导入不进仓库内索引", () => {
  const index = importsOf("lib/a.test.ts", 'import { readFile } from "node:fs/promises";\n');

  assert.equal(isImportedByTest(index, "lib/a.ts", "readFile"), false);
});
