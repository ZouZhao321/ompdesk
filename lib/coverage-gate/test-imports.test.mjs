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
  const index = importsOf("lib/rules/b.test.mjs", 'import { one } from "../a.ts";\nimport { two } from "../deep/c";\n');

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

test("解构的动态导入按解构出的名字登记", () => {
  const index = importsOf("lib/a.test.ts", 'const { foo, bar: renamed } = await import("./a.ts");\n');

  assert.equal(isImportedByTest(index, "lib/a.ts", "foo"), true);
  assert.equal(isImportedByTest(index, "lib/a.ts", "bar"), true);
  assert.equal(isImportedByTest(index, "lib/a.ts", "renamed"), false);
});

test("绑定命名空间对象的动态导入视为导入了全部符号", () => {
  const index = importsOf("lib/a.test.ts", 'const api = await import("./a.ts");\napi.anyName();\n');

  assert.equal(isImportedByTest(index, "lib/a.ts", "anyName"), true);
});

test("jiti.import 与测试回调里的动态导入同样计入", () => {
  const index = importsOf(
    "lib/a.test.ts",
    'test("x", async () => {\n  const { foo } = await jiti.import("./a.tsx");\n});\n',
  );

  assert.equal(isImportedByTest(index, "lib/a.tsx", "foo"), true);
});

test("只做副作用加载的动态导入不贡献符号名", () => {
  const index = importsOf("lib/a.test.ts", 'await import("./a.ts");\n');

  assert.equal(isImportedByTest(index, "lib/a.ts", "foo"), false);
});
