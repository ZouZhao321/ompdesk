import assert from "node:assert/strict";
import test from "node:test";
import { baselineJson, generateBaseline, parseBaseline } from "./export-baseline.ts";

/**
 * 基线的生成只看分叉点的源码：这里用固定样本代替提交内容，验证三件事——
 * 有生产引用的导出不进基线、框架按路径调用的导出不进基线、`scripts/` 的导入算生产引用。
 */

const SOURCES = new Map([
  ["lib/used.ts", "export function used() {}\nexport function orphan() {}\n"],
  ["lib/consumer.ts", 'import { used } from "./used";\nused();\n'],
  ["lib/script-only.ts", "export function helper() {}\n"],
  ["scripts/tool.mjs", 'import { helper } from "../lib/script-only";\nhelper();\n'],
  ["app/api/thing/route.ts", "export async function GET() {}\nexport function formatBody() {}\n"],
  ["lib/used.test.mjs", 'import { orphan } from "./used.ts";\norphan();\n'],
]);

const FILES = [...SOURCES.keys()];

function generate() {
  return generateBaseline({
    files: FILES,
    readSource: async (filePath) => SOURCES.get(filePath) ?? null,
  });
}

test("基线只收没有生产引用的导出，测试引用不算", async () => {
  const { entries } = await generate();

  assert.deepEqual(
    entries.map((entry) => `${entry.path}#${entry.name}#${entry.kind}`),
    ["app/api/thing/route.ts#formatBody#runtime", "lib/used.ts#orphan#runtime"],
  );
});

test("框架按路径调用的导出与 scripts/ 的引用都不进基线", async () => {
  const { entries } = await generate();
  const keys = entries.map((entry) => `${entry.path}#${entry.name}`);

  // GET 由 Next.js 按方法名调用，不需要 import。
  assert.ok(!keys.includes("app/api/thing/route.ts#GET"));
  // scripts/tool.mjs 通过 import 使用 helper，属于生产引用。
  assert.ok(!keys.includes("lib/script-only.ts#helper"));
  assert.ok(!keys.includes("lib/used.ts#used"));
});

test("文件读取失败时跳过，不影响其余条目", async () => {
  const result = await generateBaseline({
    files: [...FILES, "lib/gone.ts"],
    readSource: async (filePath) => (filePath === "lib/gone.ts" ? null : (SOURCES.get(filePath) ?? null)),
  });

  assert.ok(result.entries.every((entry) => entry.path !== "lib/gone.ts"));
  // 读不到的文件不计入扫描数。
  assert.equal(result.scannedFiles, SOURCES.size - 1);
});

test("序列化按路径、名字、种类排序，同一份输入产出同一份文件", async () => {
  const { entries } = await generate();
  const text = baselineJson(entries);

  assert.equal(baselineJson([...entries].reverse()), text);
  assert.deepEqual(parseBaseline(text), entries);
  assert.match(text, /^\{\n {2}"symbols": \[\n/);
});
