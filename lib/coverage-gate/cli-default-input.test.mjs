import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCoverageGate } from "./cli.ts";

const MERGE_BASE = "0123456789abcdef0123456789abcdef01234567";

const LCOV = [
  "SF:lib\\hit.ts",
  "FNF:4",
  "FNH:4",
  "LF:20",
  "LH:12",
  "end_of_record",
].join("\n");

function sampleGit() {
  return {
    repositoryRoot: async () => "/repo",
    mergeBase: async () => MERGE_BASE,
    changedFiles: async () => [],
    managedSourceFiles: async () => [],
  };
}

test("没有注入读取函数时从磁盘上的产物读取 lcov", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ompdesk-gate-cli-"));
  try {
    const lcovPath = path.join(directory, "lcov.info");
    writeFileSync(lcovPath, LCOV);

    // 只注入 git，`readText` 走默认实现：读 lcovPath 指向的真实文件。
    const result = await runCoverageGate({ cwd: directory, lcovPath }, { git: sampleGit() });

    assert.equal(result.exitCode, 0);
    assert.match(result.report, /仓库内合计（加权）/);
    assert.match(result.report, /行覆盖 12\/20（60\.00%）/);
    assert.match(result.report, /函数覆盖 4\/4（100\.00%）/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("git 读不到分叉点时给出可定位的报告，不抛异常", async () => {
  const result = await runCoverageGate(
    { cwd: "/repo", lcovPath: "/repo/lcov.info" },
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

test("导出分析读不出源码时报告写明原因", async () => {
  const result = await runCoverageGate(
    { cwd: "/repo", lcovPath: "/repo/lcov.info" },
    {
      readText: async () => "export const hit = 1;\n",
      git: {
        ...sampleGit(),
        changedFiles: async () => [{ path: "lib/hit.ts", status: "modified" }],
        managedSourceFiles: async () => ["lib/hit.ts"],
      },
      readBaseText: async () => {
        throw new Error("base missing");
      },
      readBaseline: async () => null,
      baseCoverage: async () => ({ ok: false, reason: "stub" }),
    },
  );

  assert.match(result.report, /导出引用分析失败/);
  assert.match(result.report, /base missing/);
});
