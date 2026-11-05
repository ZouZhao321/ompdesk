#!/usr/bin/env bun
/**
 * 覆盖率门禁的命令行入口。判定逻辑全部在 lib/coverage-gate/cli.ts，本文件只解析参数、
 * 打印报告、设置退出码。
 *
 * 规则有判定结果时退出码为 1，合并检查随之变红；产物或 git 数据不可用时保持 0。
 *
 * 用法：
 *   bun run coverage:gate
 *   bun scripts/coverage-gate.mjs --lcov .tmp/coverage-gate/lcov.info --base origin/main
 */

import { DEFAULT_BASE_REF, runCoverageGate } from "../lib/coverage-gate/cli.ts";

const DEFAULT_LCOV_PATH = ".tmp/coverage-gate/lcov.info";

function readOption(args, flag, fallback) {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

const args = process.argv.slice(2);
const lcovPath = readOption(args, "--lcov", DEFAULT_LCOV_PATH);
const baseRef = readOption(
  args,
  "--base",
  process.env.COVERAGE_GATE_BASE ?? DEFAULT_BASE_REF,
);

const result = await runCoverageGate({ cwd: process.cwd(), lcovPath, baseRef });
process.stdout.write(`${result.report}\n`);
process.exitCode = result.exitCode;
