import assert from "node:assert/strict";
import test from "node:test";
import { runCoverageGate } from "./cli.ts";

const LCOV = [
  "SF:lib\\hit.ts",
  "FNF:4",
  "FNH:3",
  "DA:1,1",
  "DA:2,0",
  "LF:20",
  "LH:12",
  "end_of_record",
  "SF:lib\\hit.ts?mtime=1",
  "FNF:99",
  "FNH:99",
  "LF:99",
  "LH:99",
  "end_of_record",
  "SF:..\\..\\..\\.omp\\extensions\\x\\index.ts",
  "LF:8",
  "LH:3",
  "end_of_record",
].join("\n");

function sampleGit(overrides = {}) {
  return {
    repositoryRoot: async () => "/repo",
    mergeBase: async () => "0123456789abcdef0123456789abcdef01234567",
    changedFiles: async () => [
      { path: "lib/hit.ts", status: "modified" },
      { path: "lib/new.ts", status: "added" },
      { path: "README.md", status: "modified" },
    ],
    managedSourceFiles: async () => ["lib/hit.ts", "lib/new.ts", "lib/other.ts"],
    ...overrides,
  };
}

function run(overrides = {}) {
  return runCoverageGate(
    { cwd: "/repo", lcovPath: ".tmp/coverage-gate/lcov.info", baseRef: "origin/main" },
    { readText: async () => LCOV, git: sampleGit(), ...overrides },
  );
}

test("命令行输出改动文件、合计、剔除去重与缺席清单", async () => {
  const result = await run();

  assert.equal(result.exitCode, 1);
  assert.match(result.report, /规则判定：1 条/);
  assert.match(result.report, /\[rule-1\] lib\/new\.ts/);
  assert.match(result.report, /理由：文件未被任何测试加载/);
  assert.match(result.report, /改动文件：2 个受管源文件/);
  assert.match(result.report, /修改 {2}lib\/hit\.ts · 行 12\/20（60\.00%） · 函数 3\/4（75\.00%）/);
  assert.match(result.report, /新增 {2}lib\/new\.ts · 行 0\/0（未加载）/);
  assert.doesNotMatch(result.report, /README\.md/);
  assert.match(result.report, /行覆盖 12\/20（60\.00%）/);
  assert.match(result.report, /函数覆盖 3\/4（75\.00%）/);
  assert.match(result.report, /仓库外或越界记录剔除 1 条/);
  assert.match(result.report, /重复路径去重忽略 1 条/);
  assert.match(result.report, /报告缺席的受管源文件：2\/3/);
  assert.match(result.report, /^ {2}lib\/new\.ts$/m);
  assert.match(result.report, /^ {2}lib\/other\.ts$/m);
});

const LCOV_ALL_LOADED = [
  "SF:lib\\hit.ts",
  "FNF:4",
  "FNH:3",
  "LF:20",
  "LH:12",
  "end_of_record",
  "SF:lib\\new.ts",
  "FNF:2",
  "FNH:2",
  "LF:8",
  "LH:8",
  "end_of_record",
].join("\n");

test("改动文件都有产物记录且新增文件函数全被调用时退出码为 0", async () => {
  const result = await run({ readText: async () => LCOV_ALL_LOADED });

  assert.equal(result.exitCode, 0);
  assert.match(result.report, /规则判定：0 条/);
  assert.match(result.report, /本步骤只报告，不阻断合并；退出码固定为 0。/);
});

test("产物缺失时打印原因，退出码仍为 0", async () => {
  const result = await run({
    readText: async () => {
      throw new Error("ENOENT: no such file");
    },
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.report, /覆盖率产物缺失：\.tmp\/coverage-gate\/lcov\.info/);
  assert.match(result.report, /先运行 bun run coverage:gate/);
});

test("分叉点读取失败时给出检出深度提示，退出码仍为 0", async () => {
  const result = await run({
    git: sampleGit({
      mergeBase: async () => {
        throw new Error("fatal: Not a valid object name origin/main");
      },
    }),
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.report, /git 数据读取失败/);
  assert.match(result.report, /fetch-depth: 0/);
});
