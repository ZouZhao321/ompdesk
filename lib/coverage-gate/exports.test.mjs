import assert from "node:assert/strict";
import test from "node:test";
import { baselineKey, collectExportUsage, referencesFor } from "./exports.ts";

function readersFor(workspace, base = {}) {
  const read = [];
  return {
    read,
    readers: {
      readWorkspace: async (filePath) => {
        read.push(filePath);
        return workspace[filePath];
      },
      readAtMergeBase: async (filePath) => base[filePath] ?? null,
    },
  };
}

/** 单文件当成新增文件跑一遍分析：所有导出都落在 `added` 里。 */
async function exportsOf(filePath, sourceText) {
  const { readers } = readersFor({ [filePath]: sourceText });
  const analysis = await collectExportUsage({
    changedFiles: [{ path: filePath, status: "added" }],
    managedFiles: [filePath],
    readers,
    baselineText: null,
  });
  return Object.fromEntries(
    analysis.added.map(({ symbol }) => [symbol.name, { kind: symbol.kind, declaration: symbol.declaration }]),
  );
}

/** 只取引用索引：样本全部当受管文件扫，改动清单留空。 */
async function indexOf(entries) {
  const workspace = Object.fromEntries(entries);
  const { readers } = readersFor(workspace);
  const analysis = await collectExportUsage({
    changedFiles: [],
    managedFiles: Object.keys(workspace),
    readers,
    baselineText: null,
  });
  return analysis.references;
}

test("提取函数、常量、类与默认导出", async () => {
  const exports = await exportsOf(
    "lib/math.ts",
    [
      "export function add(a: number, b: number): number { return a + b; }",
      "export const MAX = 10;",
      "export class Calc { total = 0; }",
      "export default function main() {}",
      "export enum Mode { A, B }",
      "export const { first, second } = { first: 1, second: 2 };",
    ].join("\n"),
  );

  assert.deepEqual(exports.add, { kind: "runtime", declaration: "function" });
  assert.deepEqual(exports.MAX, { kind: "runtime", declaration: "variable" });
  assert.deepEqual(exports.Calc, { kind: "runtime", declaration: "class" });
  assert.deepEqual(exports.main, undefined);
  assert.deepEqual(exports.default, { kind: "runtime", declaration: "default" });
  assert.deepEqual(exports.Mode, { kind: "runtime", declaration: "enum" });
  assert.deepEqual(exports.first, { kind: "runtime", declaration: "variable" });
  assert.deepEqual(exports.second, { kind: "runtime", declaration: "variable" });
});

test("仅类型导出与运行时导出分开标记", async () => {
  const exports = await exportsOf(
    "lib/shapes.ts",
    [
      "export type Shape = { width: number };",
      "export interface Box { height: number }",
      "type Internal = string;",
      "export { type Internal as PublicName };",
      "export type { Internal as Other };",
      "export const value = 1;",
    ].join("\n"),
  );

  assert.deepEqual(exports.Shape, { kind: "type", declaration: "type" });
  assert.deepEqual(exports.Box, { kind: "type", declaration: "interface" });
  assert.deepEqual(exports.PublicName, { kind: "type", declaration: "alias" });
  assert.deepEqual(exports.Other, { kind: "type", declaration: "alias" });
  assert.deepEqual(exports.value, { kind: "runtime", declaration: "variable" });
});

test("重命名导出沿用本地声明的种类", async () => {
  const exports = await exportsOf(
    "lib/alias.ts",
    ["function helper() {}", "type Local = number;", "export { helper as run, Local as LocalType };"].join("\n"),
  );

  assert.deepEqual(exports.run, { kind: "runtime", declaration: "alias" });
  assert.deepEqual(exports.LocalType, { kind: "type", declaration: "alias" });
});

test("具名导入与默认导入算作生产引用", async () => {
  const index = await indexOf(
    new Map([
      ["lib/math.ts", "export function add() {}\nexport const MAX = 1;\nexport default function main() {}"],
      ["lib/use.ts", 'import main, { add, MAX } from "./math";\nexport const total = main(add, MAX);'],
    ]),
  );

  assert.deepEqual(referencesFor(index, "lib/math.ts", "add"), ["lib/use.ts"]);
  assert.deepEqual(referencesFor(index, "lib/math.ts", "MAX"), ["lib/use.ts"]);
  assert.deepEqual(referencesFor(index, "lib/math.ts", "default"), ["lib/use.ts"]);
});

test("定义文件内部的使用不算生产引用", async () => {
  const index = await indexOf(
    new Map([
      ["lib/math.ts", "export const MAX = 1;\nexport function double() { return MAX * 2; }"],
      ["lib/use.ts", 'import { double } from "./math";\nexport const value = double();'],
    ]),
  );

  assert.deepEqual(referencesFor(index, "lib/math.ts", "MAX"), []);
  assert.deepEqual(referencesFor(index, "lib/math.ts", "double"), ["lib/use.ts"]);
});

test("通过转出口导入时记到定义处", async () => {
  const index = await indexOf(
    new Map([
      ["lib/allowed-roots.ts", "export function allowFileRoot() {}"],
      ["lib/file-access.ts", 'export { allowFileRoot } from "./allowed-roots";'],
      ["app/api/route.ts", 'import { allowFileRoot } from "@/lib/file-access";\nallowFileRoot();'],
    ]),
  );

  // 转出文件本身也是一处生产使用：它把这个符号暴露给了别的模块。
  assert.deepEqual(referencesFor(index, "lib/allowed-roots.ts", "allowFileRoot"), [
    "app/api/route.ts",
    "lib/file-access.ts",
  ]);
});

test("命名空间导入算作引用该模块的全部导出", async () => {
  const index = await indexOf(
    new Map([
      ["lib/math.ts", "export function add() {}\nexport const MAX = 1;"],
      ["lib/use.ts", 'import * as math from "./math";\nexport const value = math.add();'],
    ]),
  );

  assert.deepEqual(referencesFor(index, "lib/math.ts", "add"), ["lib/use.ts"]);
  assert.deepEqual(referencesFor(index, "lib/math.ts", "MAX"), ["lib/use.ts"]);
});

test("别名为 @/ 与目录索引的导入都能解析", async () => {
  const index = await indexOf(
    new Map([
      ["lib/math.ts", "export function add() {}"],
      ["lib/nested/index.ts", "export function nested() {}"],
      [
        "app/page.tsx",
        'import { add } from "@/lib/math";\nimport { nested } from "@/lib/nested";\nexport const value = add(nested);',
      ],
    ]),
  );

  assert.deepEqual(referencesFor(index, "lib/math.ts", "add"), ["app/page.tsx"]);
  assert.deepEqual(referencesFor(index, "lib/nested/index.ts", "nested"), ["app/page.tsx"]);
});

test("包名导入不参与仓库内的引用统计", async () => {
  const index = await indexOf(
    new Map([["lib/use.ts", 'import { useState } from "react";\nexport const value = useState(0);']]),
  );

  assert.equal(index.size, 0);
});

test("新增导出来自分叉点与工作区的结构对比", async () => {
  const { readers } = readersFor(
    {
      "lib/changed.ts": "export function kept() {}\nexport function fresh() {}",
      "lib/kept.ts": "export const kept = 1;",
    },
    { "lib/changed.ts": "export function kept() {}" },
  );

  const analysis = await collectExportUsage({
    changedFiles: [{ path: "lib/changed.ts", status: "modified" }],
    managedFiles: ["lib/changed.ts", "lib/kept.ts"],
    readers,
    baselineText: null,
  });

  assert.deepEqual(
    analysis.added.map((item) => `${item.file}:${item.symbol.name}`),
    ["lib/changed.ts:fresh"],
  );
  assert.equal(analysis.scannedFiles, 2);
});

test("新增文件的所有导出都算新增，改名文件按旧路径对比", async () => {
  const { readers } = readersFor(
    {
      "lib/added.ts": "export const value = 1;",
      "lib/renamed.ts": "export const stable = 1;",
    },
    { "lib/old-name.ts": "export const stable = 1;" },
  );

  const analysis = await collectExportUsage({
    changedFiles: [
      { path: "lib/added.ts", status: "added" },
      { path: "lib/renamed.ts", status: "renamed", previousPath: "lib/old-name.ts" },
    ],
    managedFiles: ["lib/added.ts", "lib/renamed.ts"],
    readers,
    baselineText: null,
  });

  assert.deepEqual(
    analysis.added.map((item) => `${item.file}:${item.symbol.name}`),
    ["lib/added.ts:value"],
  );
});

test("引用索引只扫受管源文件，测试文件不进生产引用", async () => {
  const { readers, read } = readersFor({
    "lib/math.ts": "export function add() {}",
    "lib/use.ts": 'import { add } from "./math";\nexport const value = add();',
  });

  const analysis = await collectExportUsage({
    changedFiles: [],
    managedFiles: ["lib/math.ts", "lib/use.ts"],
    readers,
    baselineText: null,
  });

  assert.deepEqual(read.sort(), ["lib/math.ts", "lib/use.ts"]);
  assert.deepEqual([...analysis.references.keys()], ["lib/math.ts"]);
});

test("基线文件解析出路径、名字与种类", async () => {
  const { readers } = readersFor({ "lib/legacy.ts": "export const value = 1;" });

  const analysis = await collectExportUsage({
    changedFiles: [],
    managedFiles: ["lib/legacy.ts"],
    readers,
    baselineText: JSON.stringify({
      symbols: [
        { path: "lib/legacy.ts", name: "old", kind: "runtime" },
        { path: "lib/legacy.ts", name: "OldType", kind: "type" },
      ],
    }),
  });

  assert.equal(analysis.baseline.size, 2);
  assert.ok(analysis.baseline.has(baselineKey("lib/legacy.ts", "old", "runtime")));
  assert.ok(analysis.baseline.has(baselineKey("lib/legacy.ts", "OldType", "type")));
});

test("基线文件结构不合法时记下错误而不是抛给调用方", async () => {
  const { readers } = readersFor({ "lib/math.ts": "export const value = 1;" });

  const analysis = await collectExportUsage({
    changedFiles: [],
    managedFiles: ["lib/math.ts"],
    readers,
    baselineText: JSON.stringify({ symbols: [{ path: "lib/math.ts", name: "value", kind: "other" }] }),
  });

  assert.match(analysis.baselineError, /kind 必须是 type 或 runtime/);
  assert.equal(analysis.baseline.size, 0);
});

test("动态导入与 require 算作生产引用", async () => {
  const index = await indexOf(
    new Map([
      ["lib/tools.ts", "export function getPreset() {}\nexport const NAME = 'x';"],
      ["hooks/use.ts", 'export async function load() { return await import("@/lib/tools"); }'],
      ["lib/legacy.ts", "export const flag = true;"],
      ["lib/loader.cjs", 'const legacy = require("./legacy");\nmodule.exports = legacy;'],
    ]),
  );

  assert.deepEqual(referencesFor(index, "lib/tools.ts", "getPreset"), ["hooks/use.ts"]);
  assert.deepEqual(referencesFor(index, "lib/tools.ts", "NAME"), ["hooks/use.ts"]);
  assert.deepEqual(referencesFor(index, "lib/legacy.ts", "flag"), ["lib/loader.cjs"]);
});

test("工作区里已删除的受管文件不算读取失败", async () => {
  const analysis = await collectExportUsage({
    changedFiles: [],
    managedFiles: ["lib/gone.ts", "lib/kept.ts"],
    readers: {
      readWorkspace: async (filePath) => {
        if (filePath === "lib/gone.ts") throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return "export const kept = 1;";
      },
      readAtMergeBase: async () => null,
    },
    baselineText: null,
  });

  assert.deepEqual(analysis.readFailures, []);
  assert.equal(analysis.scannedFiles, 1);
});

test("单个文件读取失败记进 readFailures，其余文件照常扫", async () => {
  const analysis = await collectExportUsage({
    changedFiles: [],
    managedFiles: ["lib/broken.ts", "lib/kept.ts"],
    readers: {
      readWorkspace: async (filePath) => {
        if (filePath === "lib/broken.ts") throw new Error("EACCES: permission denied");
        return "export const kept = 1;";
      },
      readAtMergeBase: async () => null,
    },
    baselineText: null,
  });

  assert.deepEqual(analysis.readFailures, ["lib/broken.ts：EACCES: permission denied"]);
  assert.equal(analysis.scannedFiles, 1);
});

test("基线不豁免本次新增的导出", async () => {
  const { readers } = readersFor({ "lib/fresh.ts": "export function helper() {}" });

  const analysis = await collectExportUsage({
    changedFiles: [{ path: "lib/fresh.ts", status: "added" }],
    managedFiles: ["lib/fresh.ts"],
    readers,
    baselineText: JSON.stringify({ symbols: [{ path: "lib/fresh.ts", name: "helper", kind: "runtime" }] }),
  });

  assert.deepEqual(
    analysis.added.map((item) => item.symbol.name),
    ["helper"],
  );
  assert.equal(analysis.baseline.size, 0);
});

test("基线条目保留分叉点之前就存在的符号", async () => {
  const { readers } = readersFor({ "lib/legacy.ts": "export function stale() {}" });

  const analysis = await collectExportUsage({
    changedFiles: [],
    managedFiles: ["lib/legacy.ts"],
    readers,
    baselineText: JSON.stringify({ symbols: [{ path: "lib/legacy.ts", name: "stale", kind: "runtime" }] }),
  });

  assert.ok(analysis.baseline.has(baselineKey("lib/legacy.ts", "stale", "runtime")));
});
