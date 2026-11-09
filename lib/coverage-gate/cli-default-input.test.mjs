import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCoverageGate, runExportGate } from "./cli.ts";
import { gitFor, lcovOf, SAMPLE_MERGE_BASE } from "../../test-support/coverage-gate-fixtures.mjs";

const MERGE_BASE = SAMPLE_MERGE_BASE;
const LCOV = lcovOf([["lib\\hit.ts", 4, 4, 12, 20]]);

/** 没有改动的仓库：改动清单与受管清单都是空的，测试文件清单显式给出。 */
function sampleGit() {
  return {
    ...gitFor([]),
    managedSourceFiles: async () => [],
    testFiles: async () => [],
  };
}

test("没有注入读取函数时从磁盘上的产物读取 lcov", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ompdesk-gate-cli-"));
  try {
    const lcovPath = path.join(directory, "lcov.info");
    writeFileSync(lcovPath, LCOV);

    // 只注入 git 与基准读取，`readText` 走默认实现：读 lcovPath 指向的真实文件。
    const result = await runCoverageGate(
      { cwd: directory, lcovPath, testDurationMs: 30_000 },
      {
        git: sampleGit(),
        readBaseline: async () => null,
        readExceptions: async () => null,
      },
    );

    assert.equal(result.exitCode, 0);
    assert.match(result.report, /仓库内合计（加权）/);
    assert.match(result.report, /行覆盖 12\/20（60\.00%）/);
    assert.match(result.report, /函数覆盖 4\/4（100\.00%）/);
    // 命令行入口给出的本次运行耗时进入报告，基准运行没有发生。
    assert.match(result.report, /本次测试运行 30\.0 秒/);
    assert.match(result.report, /基准运行 —（本次没有需要比对的改动文件，跳过）/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("默认产物路径与报告里的缺席清单来自同一份共享定义", async () => {
  const result = await runCoverageGate(
    { cwd: "/repo" },
    {
      readText: async () => {
        throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
      },
      git: sampleGit(),
      readBaseline: async () => null,
      readExceptions: async () => null,
    },
  );

  assert.equal(result.exitCode, 2);
  assert.match(result.report, /覆盖率产物缺失：\.tmp\/coverage-gate\/lcov\.info/);
});

test("静态引用检查默认从磁盘读基线与源码", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ompdesk-gate-exports-"));
  try {
    mkdirSync(path.join(directory, "lib"), { recursive: true });
    writeFileSync(path.join(directory, "lib", "new.ts"), "export function lonely() {}\n");
    writeFileSync(path.join(directory, "lib", "use.ts"), "export const value = 1;\n");
    writeFileSync(
      path.join(directory, "coverage-export-baseline.json"),
      JSON.stringify({ symbols: [{ path: "lib/kept.ts", name: "old", kind: "runtime" }] }),
    );

    // 只注入 git 与分叉点读取；基线、源码与豁免清单都走默认的磁盘实现。
    const result = await runExportGate(
      { cwd: directory },
      {
        readBaseText: async () => null,
        git: {
          repositoryRoot: async () => directory,
          mergeBase: async () => MERGE_BASE,
          changedFiles: async () => [{ path: "lib/new.ts", status: "added" }],
          managedSourceFiles: async () => ["lib/new.ts", "lib/use.ts"],
        },
      },
    );

    assert.equal(result.exitCode, 1);
    assert.match(result.report, /分叉点基线条目 1 条/);
    assert.match(result.report, /\[rule-3\] lib\/new\.ts/);
    assert.match(result.report, /lonely（运行时导出）生产引用 0/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("基线路径读不出来（非 ENOENT）时按导出分析失败报流水线问题", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ompdesk-gate-baseline-"));
  try {
    // 基线路径被目录占住：默认读取实现读到 EISDIR，必须原样抛出交给上层归因，
    // 而不是像文件不存在那样当成「没有基线」。
    mkdirSync(path.join(directory, "coverage-export-baseline.json"));

    const result = await runExportGate(
      { cwd: directory },
      {
        readBaseText: async () => null,
        git: {
          repositoryRoot: async () => directory,
          mergeBase: async () => MERGE_BASE,
          changedFiles: async () => [],
          managedSourceFiles: async () => [],
        },
      },
    );

    assert.equal(result.exitCode, 1);
    assert.match(result.report, /\[rule-3\] （导出分析）/);
    assert.match(result.report, /导出引用分析失败：EISDIR/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("导出分析读不出分叉点源码时规则三报成流水线问题", async () => {
  const result = await runExportGate(
    { cwd: "/repo" },
    {
      readText: async () => "export const hit = 1;\n",
      git: {
        ...sampleGit(),
        changedFiles: async () => [{ path: "lib/hit.ts", status: "modified" }],
      },
      readBaseText: async () => {
        throw new Error("base missing");
      },
      readBaseline: async () => null,
    },
  );

  assert.equal(result.exitCode, 1);
  assert.match(result.report, /\[rule-3\] （受管源文件）/);
  assert.match(result.report, /读取失败 1 处/);
  assert.match(result.report, /分叉点 lib\/hit\.ts：base missing/);
});

test("基线读不出来时导出分析整体降级，规则三报成流水线问题", async () => {
  const result = await runExportGate(
    { cwd: "/repo" },
    {
      readText: async () => "export const hit = 1;\n",
      git: sampleGit(),
      readBaseline: async () => {
        throw new Error("baseline unreadable");
      },
    },
  );

  assert.equal(result.exitCode, 1);
  assert.match(result.report, /\[rule-3\] （导出分析）/);
  assert.match(result.report, /导出引用分析未完成/);
  assert.match(result.report, /导出引用分析失败：baseline unreadable/);
});
