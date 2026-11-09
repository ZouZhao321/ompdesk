#!/usr/bin/env bun
/**
 * 覆盖率门禁的命令行入口。本地 `bun run coverage:gate` 与合并检查走同一条命令，工作流
 * 只调用 `bun run ci`，不另抄步骤。
 *
 * 三步：
 *
 * 1. 跑带覆盖率的全套测试并产出 lcov，实测耗时；
 * 2. 判定逻辑全部在 `lib/coverage-gate/cli.ts`，本文件只解析参数、打印报告、设置退出码；
 * 3. 报告里给出三段耗时：本次测试运行、基准运行、分析。
 *
 * 测试失败时直接以它的退出码结束，不渲染判定：判定不建立在半份产物上，与逐个命令用
 * `&&` 串联时的语义一致。
 *
 * 用法：
 *   bun run coverage:gate
 *   bun scripts/coverage-gate.mjs --base origin/main
 */

import { spawnSync } from "node:child_process";
import { DEFAULT_BASE_REF, runCoverageGate } from "../lib/coverage-gate/cli.ts";
import { coverageTestArgs } from "../lib/coverage-gate/test-command.ts";

function readOption(args, flag, fallback) {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

const args = process.argv.slice(2);
const baseRef = readOption(args, "--base", process.env.COVERAGE_GATE_BASE ?? DEFAULT_BASE_REF);

const testStartedAt = Date.now();
const testRun = spawnSync(process.execPath, coverageTestArgs(), {
  cwd: process.cwd(),
  stdio: "inherit",
});
const testDurationMs = Date.now() - testStartedAt;

if (testRun.status !== 0) {
  process.stderr.write(`\n覆盖率门禁：测试运行失败（退出码 ${testRun.status ?? "未知"}），本次不产出判定。\n`);
  process.exit(testRun.status ?? 1);
}

const lcovPath = readOption(args, "--lcov", null);

const result = await runCoverageGate({
  cwd: process.cwd(),
  ...(lcovPath === null ? {} : { lcovPath }),
  baseRef,
  testDurationMs,
});
process.stdout.write(`${result.report}\n`);
process.exitCode = result.exitCode;
