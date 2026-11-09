import assert from "node:assert/strict";
import test from "node:test";
import { runCoverageGate } from "./cli.ts";

const MERGE_BASE = "0123456789abcdef0123456789abcdef01234567";
const LCOV_FILE = ".tmp/coverage-gate/lcov.info";
const BASE_SOURCE = [
  "export function a1() {}",
  "export function a2() {}",
  "export function a3() {}",
  "export function a4() {}",
  "",
].join("\n");
const HEAD_SOURCE = `${BASE_SOURCE}function added() {}\n`;
const LCOV = [
  "SF:lib\\a.ts",
  "FNF:5",
  "FNH:3",
  "LF:10",
  "LH:8",
  "end_of_record",
  "SF:lib\\orphan.ts",
  "FNF:1",
  "FNH:1",
  "LF:2",
  "LH:2",
  "end_of_record",
].join("\n");

const TEXTS = new Map([
  [LCOV_FILE, LCOV],
  ["lib/a.ts", HEAD_SOURCE],
  ["lib/orphan.ts", "export function lonely() {}\n"],
  ["lib/unloaded.ts", "function idle() {}\n"],
]);

/** 调用方会把仓库根拼进去，Windows 上是反斜杠；样本表按 `/` 索引。 */
function textOf(filePath) {
  return TEXTS.get(filePath.replace(/\\/g, "/"));
}

/** 三条规则各触发一条判定：未加载文件、新增函数没被调用、新增导出没有生产引用。 */
function dependencies() {
  return {
    readText: async (filePath) => {
      const text = textOf(filePath);
      if (text === undefined) throw new Error(`意外的文件读取：${filePath}`);
      return text;
    },
    readBaseText: async (_root, _revision, filePath) => (filePath === "lib/a.ts" ? BASE_SOURCE : null),
    readBaseline: async () => null,
    readExceptions: async () => null,
    today: "2026-11-06",
    git: {
      repositoryRoot: async () => "",
      mergeBase: async () => MERGE_BASE,
      changedFiles: async () => [
        { path: "lib/a.ts", status: "modified" },
        { path: "lib/orphan.ts", status: "added" },
        { path: "lib/unloaded.ts", status: "added" },
      ],
      managedSourceFiles: async () => ["lib/a.ts", "lib/orphan.ts", "lib/unloaded.ts"],
    },
    baseCoverage: async () => ({
      ok: true,
      coverage: new Map([
        [
          "lib/a.ts",
          {
            path: "lib/a.ts",
            linesFound: 10,
            linesHit: 10,
            functionsFound: 4,
            functionsHit: 3,
          },
        ],
      ]),
      durationMs: 12_000,
      worktreePath: "/repo/.tmp/coverage-gate-base/base",
    }),
    sources: async (_root, _revision, file) => ({
      base: file.path === "lib/a.ts" ? BASE_SOURCE : null,
      head: textOf(file.path) ?? null,
    }),
  };
}

/** 每条判定的输出块：从缩进两格的规则行到下一个规则行之前。 */
function findingBlocks(report) {
  return report.split(/\n(?= {2}\[rule-)/).filter((block) => /^ {2}\[rule-/.test(block));
}

test("每条失败输出都带规则编号、文件、数字、理由、修复五项", async () => {
  const result = await runCoverageGate({ cwd: "/repo", lcovPath: LCOV_FILE }, dependencies());

  assert.equal(result.exitCode, 1);
  const blocks = findingBlocks(result.report);
  assert.deepEqual(
    blocks.map((block) => /^ {2}\[([^\]]+)\]/.exec(block)[1]),
    ["rule-1", "rule-2", "rule-3"],
  );

  for (const block of blocks) {
    // 第一行：规则编号 + 文件；后三行各自以四项之一开头，五项都非空。
    assert.match(block, /^ {2}\[rule-[123]\] \S+/);
    assert.match(block, /\n {7}数字：\S/);
    assert.match(block, /\n {7}理由：\S/);
    assert.match(block, /\n {7}修复：\S/);
  }

  assert.match(result.report, /\[rule-2\] lib\/a\.ts/);
  assert.match(result.report, /数字：改动前 3\/4，改动后 3\/5，新增 1 个函数，被调用数增加 0/);
  assert.match(result.report, /\[rule-3\] lib\/orphan\.ts/);
  assert.match(result.report, /lonely（运行时导出）生产引用 0/);
});
