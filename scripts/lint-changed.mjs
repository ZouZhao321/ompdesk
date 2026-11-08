#!/usr/bin/env bun
/**
 * 只检查改动过的源码文件，并且只把落在本次改动行上的 error 算失败。
 *
 * 全仓 lint 还有 8 个存量 error（`react-hooks/preserve-manual-memoization`，落在
 * `components/ChatInput.tsx` 与 `hooks/useAgentSession.ts`）。整文件检查会让任何
 * 碰到这两个文件的 PR 变红，与改动本身无关；因此按行过滤：新增文件整份检查，
 * 已有文件只看这次写入或改写过的行。
 *
 * 基线取 `LINT_BASE`，CI 传 `github.event.pull_request.base.sha`；本地默认
 * `git merge-base origin/main HEAD`。用三个点取差集，main 上刚合入的改动不算在内。
 */

import { spawnSync } from "node:child_process";
import { createGitEnv } from "../lib/git-env.ts";

const EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/;
const BATCH = 40;

function git(args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    env: createGitEnv(),
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

/** 读取文件在本次改动里的新增行区间，行号按当前版本计算。 */
function addedRanges(base, file) {
  const ranges = [];
  const diff = git(["diff", "-U0", "--no-color", `${base}...HEAD`, "--", file]);
  for (const line of diff.split("\n")) {
    const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count > 0) ranges.push([start, start + count - 1]);
  }
  return ranges;
}

const base = process.env.LINT_BASE?.trim() || git(["merge-base", "origin/main", "HEAD"]).trim();
const changed = git(["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`])
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && EXTENSIONS.test(line));

if (changed.length === 0) {
  process.stdout.write("[lint] 没有改动过的源码文件\n");
  process.exit(0);
}

const ranges = new Map(changed.map((file) => [file, addedRanges(base, file)]));
const failures = [];

for (let index = 0; index < changed.length; index += BATCH) {
  const batch = changed.slice(index, index + BATCH);
  // Windows 命令行上限约 32K 字符，一次传入几百个路径会失败，所以按批调用。
  const result = spawnSync(
    process.execPath,
    ["x", "eslint", "--no-warn-ignored", "--no-error-on-unmatched-pattern", "-f", "json", ...batch],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  // 退出码 2 是 eslint 自身出错（配置损坏、解析器缺失），不能当成「有 error」。
  if (result.status === 2) {
    process.stderr.write(result.stderr);
    process.exit(2);
  }

  for (const file of JSON.parse(result.stdout || "[]")) {
    const absolute = file.filePath.replaceAll("\\", "/");
    const relative = changed.find((candidate) => absolute === candidate || absolute.endsWith(`/${candidate}`));
    const own = relative ? ranges.get(relative) : [];
    for (const message of file.messages) {
      if (message.severity !== 2) continue;
      const line = message.line ?? 0;
      if (!own.some(([from, to]) => line >= from && line <= to)) continue;
      failures.push(`${relative ?? absolute}:${line}:${message.column} ${message.ruleId} ${message.message}`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`[lint] ${failures.length} 个 error 落在改动行上\n`);
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.exit(1);
}

process.stdout.write(`[lint] ${changed.length} 个改动文件，改动行上没有 error\n`);
