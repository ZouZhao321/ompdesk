import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCoverageGate } from "./cli.ts";

const MERGE_BASE = "0123456789abcdef0123456789abcdef01234567";

const LCOV = ["SF:lib\\hit.ts", "FNF:4", "FNH:4", "LF:20", "LH:12", "end_of_record"].join("\n");

function sampleGit() {
  return {
    repositoryRoot: async () => "/repo",
    mergeBase: async () => MERGE_BASE,
    changedFiles: async () => [],
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

  assert.equal(result.exitCode, 0);
  assert.match(result.report, /覆盖率产物缺失：\.tmp\/coverage-gate\/lcov\.info/);
});

test("git 读不到分叉点时给出可定位的报告，不抛异常", async () => {
  const result = await runCoverageGate(
    { cwd: "/repo" },
    {
      readText: async () => LCOV,
      git: {
        ...sampleGit(),
        mergeBase: async () => {
          throw new Error("boom");
        },
      },
    },
  );

  assert.match(result.report, /无法读取分叉点|git 数据读取失败/);
  assert.match(result.report, /boom/);
});

test("导出分析读不出源码时规则三报成流水线问题", async () => {
  const result = await runCoverageGate(
    { cwd: "/repo", lcovPath: "/repo/lcov.info" },
    {
      readText: async (filePath) => (filePath.endsWith("lcov.info") ? LCOV : "export const hit = 1;\n"),
      git: {
        ...sampleGit(),
        changedFiles: async () => [{ path: "lib/hit.ts", status: "modified" }],
        managedSourceFiles: async () => ["lib/hit.ts"],
      },
      readBaseText: async () => {
        throw new Error("base missing");
      },
      readBaseline: async () => null,
      baseCoverage: async () => ({ ok: true, coverage: new Map(), durationMs: 0, worktreePath: "/tmp/base" }),
      sources: async () => ({ base: "export const hit = 1;\n", head: "export const hit = 1;\n" }),
    },
  );

  assert.equal(result.exitCode, 1);
  assert.match(result.report, /\[rule-3\] （受管源文件）/);
  assert.match(result.report, /读取失败 1 处/);
  assert.match(result.report, /分叉点 lib\/hit\.ts：base missing/);
});

test("基线读不出来时导出分析整体降级，规则三报成流水线问题", async () => {
  const result = await runCoverageGate(
    { cwd: "/repo", lcovPath: "/repo/lcov.info" },
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
