#!/usr/bin/env bun
/**
 * 覆盖率门禁的命令行入口。工作流只调用 `bun run ci`，不另抄步骤；本地复现用同一组命令。
 *
 * 三个模式：
 *
 * - `--exports-only`（`bun run coverage:exports`）：规则三，静态引用检查。不跑测试，
 *   因此排在测试之前，失败时省下两次测试运行。
 * - 默认（`bun run coverage:gate`）：跑一次带覆盖率的全套测试，再判定规则一与规则二。
 * - `--write-baseline`（`bun run coverage:baseline`）：按分叉点的源码重新生成导出基线。
 *
 * 退出码：0 通过；1 有判定未通过或测试失败（静态引用检查读不到源码时也在这里报流水线
 * 问题）；2 门禁没有跑起来（产物缺失、git 读不到分叉点、测试文件导入读不出来）。判定
 * 逻辑全部在 `lib/coverage-gate/`，本文件只解析参数、跑测试、打印报告、设置退出码。
 *
 * 用法：
 *   bun run coverage:exports
 *   bun run coverage:gate
 *   bun run coverage:baseline -- --base origin/main
 *   bun scripts/coverage-gate.mjs --base origin/main
 */

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_BASE_REF, runCoverageGate, runExportGate } from "../lib/coverage-gate/cli.ts";
import { baselineJson, BASELINE_FILE, generateBaseline } from "../lib/coverage-gate/export-baseline.ts";
import { listFilesAtRevision, readFileAtRevision, repositoryRoot, resolveMergeBase } from "../lib/coverage-gate/git.ts";
import { coverageTestArgs, coverageTestEnv, parseTestSummary } from "../lib/coverage-gate/test-command.ts";

/** 与 `lib/coverage-gate/cli.ts` 的退出码一致：1 是代码的问题，2 是门禁没跑起来。 */
const FAILURE_EXIT_CODE = 1;
const UNAVAILABLE_EXIT_CODE = 2;

function readOption(args, flag, fallback) {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

/** 跑一次带覆盖率的测试：输出照常透传，同时留一份用于取用例统计。 */
function runCoverageTests() {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, coverageTestArgs(), {
      cwd: process.cwd(),
      env: coverageTestEnv(),
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.on("close", (status) =>
      resolve({
        status,
        durationMs: Date.now() - startedAt,
        summary: parseTestSummary(output),
      }),
    );
  });
}

async function writeBaseline(baseRef) {
  const root = await repositoryRoot(process.cwd());
  const mergeBase = await resolveMergeBase(process.cwd(), baseRef);
  const files = await listFilesAtRevision(root, mergeBase);
  const { entries, scannedFiles } = await generateBaseline({
    files,
    readSource: (filePath) => readFileAtRevision(root, mergeBase, filePath),
  });
  await writeFile(path.join(root, BASELINE_FILE), baselineJson(entries), "utf8");
  process.stdout.write(
    `导出基线已按分叉点 ${mergeBase.slice(0, 7)} 重新生成：` +
      `${entries.length} 条存量无引用导出，扫描 ${scannedFiles} 个文件 → ${BASELINE_FILE}\n`,
  );
}

const args = process.argv.slice(2);
const baseRef = readOption(args, "--base", process.env.COVERAGE_GATE_BASE ?? DEFAULT_BASE_REF);

if (args.includes("--write-baseline")) {
  try {
    await writeBaseline(baseRef);
  } catch (error) {
    process.stderr.write(
      `覆盖率门禁：基线生成失败（${error instanceof Error ? error.message : String(error)}）。` +
        `退出码 ${UNAVAILABLE_EXIT_CODE}。\n`,
    );
    process.exitCode = UNAVAILABLE_EXIT_CODE;
  }
} else if (args.includes("--exports-only")) {
  const result = await runExportGate({ cwd: process.cwd(), baseRef });
  process.stdout.write(`${result.report}\n`);
  process.exitCode = result.exitCode;
} else {
  const testRun = await runCoverageTests();

  if (testRun.status !== 0) {
    const command = `bun ${coverageTestArgs().join(" ")}`;
    process.stderr.write(
      "\n覆盖率门禁：本次带覆盖率的测试没有通过" +
        `（bun test 退出码 ${testRun.status ?? "未知"}），本次不产出判定。\n` +
        `  命令：${command}\n` +
        `  环境：OMPDESK_LIVE_SMOKE=0 OMPDESK_LIVE_MODEL=0\n` +
        "  先修测试再重跑 bun run coverage:gate。\n" +
        `  退出码 ${FAILURE_EXIT_CODE}。\n`,
    );
    process.exit(FAILURE_EXIT_CODE);
  }

  const lcovPath = readOption(args, "--lcov", null);
  const result = await runCoverageGate({
    cwd: process.cwd(),
    ...(lcovPath === null ? {} : { lcovPath }),
    baseRef,
    testDurationMs: testRun.durationMs,
    ...(testRun.summary === null ? {} : { testSummary: testRun.summary }),
  });
  process.stdout.write(`${result.report}\n`);
  process.exitCode = result.exitCode;
}
