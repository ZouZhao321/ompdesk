import assert from "node:assert/strict";
import test from "node:test";
import { runCoverageGate } from "./cli.ts";
import { lcovOf, metricsOf, SAMPLE_MERGE_BASE } from "../../test-support/coverage-gate-fixtures.mjs";

const MERGE_BASE = SAMPLE_MERGE_BASE;

/** 固定样本：正文、基准覆盖率与 git 结果都由参数给出，不读真实仓库。 */
function run({
  lcovText,
  changedFiles,
  managedFiles,
  files,
  baseSources = {},
  baseCoverage = [],
  deletedFiles = [],
  testFiles = [],
}) {
  return runCoverageGate(
    { cwd: "/repo", lcovPath: ".tmp/coverage-gate/lcov.info", baseRef: "origin/main" },
    {
      readText: async (filePath) => {
        const normalized = filePath.replace(/\\/g, "/");
        if (normalized.endsWith("lcov.info")) return lcovText;
        return files[normalized.slice(normalized.indexOf("lib/"))] ?? "";
      },
      readBaseText: async (_root, _revision, filePath) => baseSources[filePath] ?? null,
      readBaseline: async () => null,
      baseCoverage: async () => ({
        ok: true,
        coverage: new Map(baseCoverage.map(([path, hit, found]) => [path, metricsOf(path, hit, found)])),
        durationMs: 12_000,
      }),
      sources: async (_root, _revision, file) => ({
        base: baseSources[file.previousPath ?? file.path] ?? null,
        head: files[file.path] ?? null,
      }),
      git: {
        repositoryRoot: async () => "/repo",
        mergeBase: async () => MERGE_BASE,
        changedFiles: async () => changedFiles,
        managedSourceFiles: async () => managedFiles,
        deletedFiles: async () => deletedFiles,
        testFiles: async () => testFiles,
      },
    },
  );
}

test("改名：旧路径基准映射到新路径，退出码 0", async () => {
  const body = "export function a() {}\nexport function b() {}\n";
  const result = await run({
    lcovText: lcovOf([["lib\\new.ts", 2, 2, 4, 4]]),
    changedFiles: [{ path: "lib/new.ts", status: "renamed", previousPath: "lib/old.ts" }],
    managedFiles: ["lib/new.ts"],
    files: { "lib/new.ts": body },
    baseSources: { "lib/old.ts": body },
    baseCoverage: [["lib/old.ts", 2, 2]],
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.report, /\[改名\] lib\/new\.ts ← lib\/old\.ts/);
  assert.match(result.report, /基准取改名前的路径/);
});

test("文件分成多个：函数名集合对应后豁免规则二，退出码 0", async () => {
  const part1 = "function a1() {}\nfunction a2() {}\n";
  const part2 = "function a3() {}\nfunction a4() {}\n";
  const original = "function a1() {}\nfunction a2() {}\nfunction a3() {}\nfunction a4() {}\n";
  const result = await run({
    lcovText: lcovOf([
      ["lib\\a-part1.ts", 2, 2, 2, 2],
      ["lib\\a-part2.ts", 2, 2, 2, 2],
    ]),
    changedFiles: [
      { path: "lib/a-part1.ts", status: "added" },
      { path: "lib/a-part2.ts", status: "added" },
    ],
    managedFiles: ["lib/a-part1.ts", "lib/a-part2.ts"],
    files: { "lib/a-part1.ts": part1, "lib/a-part2.ts": part2 },
    baseSources: { "lib/a.ts": original },
    baseCoverage: [["lib/a.ts", 4, 4]],
    deletedFiles: ["lib/a.ts"],
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.report, /\[文件分成多个\] lib\/a\.ts → lib\/a-part1\.ts、lib\/a-part2\.ts/);
  assert.match(result.report, /函数名集合完整对应/);
});

test("替换式改动：净增量为零，输出疑似替换并转人工豁免，退出码 0", async () => {
  const base = "function old1() {}\nfunction old2() {}\n";
  const head = "function new1() {}\nfunction new2() {}\n";
  const result = await run({
    lcovText: lcovOf([["lib\\a.ts", 2, 2, 4, 4]]),
    changedFiles: [{ path: "lib/a.ts", status: "modified" }],
    managedFiles: ["lib/a.ts"],
    files: { "lib/a.ts": head },
    baseSources: { "lib/a.ts": base },
    baseCoverage: [["lib/a.ts", 2, 2]],
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.report, /\[疑似替换\] lib\/a\.ts/);
  assert.match(result.report, /转人工豁免/);
});

test("新增的对外函数没被测试导入：退出码 1，输出规则二", async () => {
  const base = "export function base() {}\n";
  const head = "export function base() {}\nexport function added1() {}\n";
  const consumer = 'import { added1 } from "./a";\nexport const value = added1();\n';
  const testFile = 'import { base } from "./a";\nbase();\n';
  const result = await run({
    lcovText: lcovOf([
      ["lib\\a.ts", 2, 2, 4, 4],
      ["lib\\use.ts", 0, 0, 2, 2],
    ]),
    changedFiles: [
      { path: "lib/a.ts", status: "modified" },
      { path: "lib/use.ts", status: "modified" },
    ],
    managedFiles: ["lib/a.ts", "lib/use.ts"],
    files: { "lib/a.ts": head, "lib/use.ts": consumer, "lib/a.test.ts": testFile },
    baseSources: { "lib/a.ts": base, "lib/use.ts": 'export const value = "none";\n' },
    baseCoverage: [
      ["lib/a.ts", 1, 1],
      ["lib/use.ts", 0, 0],
    ],
    testFiles: ["lib/a.test.ts"],
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.report, /\[rule-2\] lib\/a\.ts/);
  assert.match(result.report, /没有出现在任何测试文件的导入语句里：added1/);
});
