#!/usr/bin/env bun
/**
 * 覆盖率门禁的命令行入口。判定逻辑全部在 lib/coverage-gate/cli.ts，本文件只解析参数、
 * 打印报告、设置退出码。
 *
 * 本票据只报告，不阻断合并：退出码固定为 0。后续票据接入规则后，失败结论从这里改成
 * 非零退出码。
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
