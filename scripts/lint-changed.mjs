#!/usr/bin/env bun
/**
 * 只检查改动过的源码文件，并且只把本次改动真正引入的 error 算失败。
 *
 * 全仓 lint 还有存量 error（`react-hooks/preserve-manual-memoization`，位于
 * `components/ChatInput.tsx` 与 `hooks/useAgentSession.ts`）。只按行过滤不够：
 * 整文件排版会把没动过的代码也写进差异，那些行上没有新代码，却会把基准里早有
 * 的 error 重新算一次，让纯排版 PR 变红。所以候选 error 还要与基准版本的同一份
 * 文件对照——按「规则 + 消息正文」计数扣除，基准里有几条就扣几条。
 *
 * 内容与基线经 Prettier 排版后的结果完全相同，说明这个文件只是被重新排版；
 * 排版不改变代码含义，这类文件整个跳过，存量 error 不会被算到本次改动上。
 *
 * 基线取 `LINT_BASE`，CI 传 `github.event.pull_request.base.sha`；本地默认
 * `git merge-base origin/main HEAD`。用三个点取差集，main 上刚合入的改动不算在内。
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import prettier from "prettier";
import { createGitEnv } from "../lib/git-env.ts";
import { dropPreExisting, parseAddedRanges } from "../lib/lint-diff.ts";

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

/** 读取失败时返回 null，不退出：用于查询可能不存在的基线版本。 */
function tryGit(args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    env: createGitEnv(),
    maxBuffer: 64 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout : null;
}

/**
 * 对一个文件跑 eslint，返回 error；`source` 为空表示检查磁盘上的当前版本。
 *
 * 检查基准版本时把内容从 stdin 传进去：工作区里只有新版本，基准版本只存在于
 * Git 对象里。退出码 2 是 eslint 自身出错（配置损坏、解析器缺失），不能当成
 * 「有 error」，直接终止。
 */
function eslintErrors(file, source) {
  const args = source
    ? ["x", "eslint", "--stdin", "--stdin-filename", file, "-f", "json"]
    : ["x", "eslint", "--no-warn-ignored", "--no-error-on-unmatched-pattern", "-f", "json", file];
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    input: source,
  });
  if (result.status === 2) {
    process.stderr.write(result.stderr);
    process.exit(2);
  }
  const parsed = JSON.parse(result.stdout || "[]");
  const entry = parsed.find((candidate) => candidate.messages);
  return entry ? entry.messages.filter((message) => message.severity === 2) : [];
}

const base = process.env.LINT_BASE?.trim() || git(["merge-base", "origin/main", "HEAD"]).trim();
const mergeBase = git(["merge-base", base, "HEAD"]).trim();
const changed = git(["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`])
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && EXTENSIONS.test(line));

if (changed.length === 0) {
  process.stdout.write("[lint] 没有改动过的源码文件\n");
  process.exit(0);
}

const ranges = new Map(
  changed.map((file) => [file, parseAddedRanges(git(["diff", "-U0", "--no-color", `${base}...HEAD`, "--", file]))]),
);

/** 位于本次改动行上的候选 error。 */
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
      failures.push({
        file: relative ?? absolute,
        line,
        column: message.column,
        ruleId: message.ruleId,
        message: message.message,
        severity: message.severity,
      });
    }
  }
}

const codeConfig = await prettier.resolveConfig("x.ts", { config: "prettier/code.config.json" });

/** 当前内容与基线内容经 Prettier 排版后完全一致，说明这个文件只是被重新排版。 */
async function isFormattingOnly(file) {
  const original = tryGit(["show", `${mergeBase}:${file}`]);
  if (original === null) return false;
  const formatted = await prettier.format(original, { ...codeConfig, filepath: file });
  return formatted === readFileSync(file, "utf8");
}

const formattingOnly = new Set();
for (const file of new Set(failures.map((failure) => failure.file))) {
  if (await isFormattingOnly(file)) formattingOnly.add(file);
}

if (formattingOnly.size > 0) {
  process.stdout.write(`[lint] 跳过 ${formattingOnly.size} 个纯排版文件：${[...formattingOnly].join("、")}\n`);
}

const remaining = new Map();
for (const failure of failures) {
  if (formattingOnly.has(failure.file)) continue;
  const list = remaining.get(failure.file) ?? [];
  list.push(failure);
  remaining.set(failure.file, list);
}

/** 扣除基准版本里已经存在的 error：同一规则、同一正文，基准有几条就扣几条。 */
let deducted = 0;
const reported = [];
for (const [file, own] of remaining) {
  const baselineText = tryGit(["show", `${mergeBase}:${file}`]);
  const baseline = baselineText === null ? [] : eslintErrors(file, baselineText);
  const kept = dropPreExisting(own, baseline);
  deducted += own.length - kept.length;
  reported.push(...kept);
}

if (reported.length > 0) {
  process.stderr.write(`[lint] ${reported.length} 个 error 落在改动行上\n`);
  for (const failure of reported) {
    process.stderr.write(`${failure.file}:${failure.line}:${failure.column} ${failure.ruleId} ${failure.message}\n`);
  }
  process.exit(1);
}

process.stdout.write(
  `[lint] ${changed.length} 个改动文件，改动行上没有 error` +
    (deducted > 0 ? `（扣除基准已有的 ${deducted} 个）` : "") +
    "\n",
);
