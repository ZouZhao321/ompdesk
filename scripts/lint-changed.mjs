#!/usr/bin/env bun
/**
 * 只检查改动过的源码文件，并且只把本次改动真正引入的 error 算失败。
 *
 * 全仓 lint 还有存量 error（`react-hooks/preserve-manual-memoization`，落在
 * `components/ChatInput.tsx` 与 `hooks/useAgentSession.ts`）。只按行过滤不够：
 * 整文件排版会把没动过的代码也写进差异，那些行上没有新代码，却会把基准里早有
 * 的 error 重新算一次，让纯排版 PR 变红。所以候选 error 还要与基准版本的同一份
 * 文件对照——按「规则 + 消息正文」计数扣除，基准里有几条就扣几条。
 *
 * 基线取 `LINT_BASE`，CI 传 `github.event.pull_request.base.sha`；本地默认
 * `git merge-base origin/main HEAD`。用三个点取差集，main 上刚合入的改动不算在内。
 */

import { spawnSync } from "node:child_process";
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

/** 读基准版本的文件内容；新增文件在基准里不存在，返回 null。 */
function gitShowOrNull(ref, file) {
 const result = spawnSync("git", ["show", `${ref}:${file}`], {
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

const base =
 process.env.LINT_BASE?.trim() ||
 git(["merge-base", "origin/main", "HEAD"]).trim();
const changed = git(["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`])
 .split("\n")
 .map((line) => line.trim())
 .filter((line) => line && EXTENSIONS.test(line));

if (changed.length === 0) {
 process.stdout.write("[lint] 没有改动过的源码文件\n");
 process.exit(0);
}

const ranges = new Map(
 changed.map((file) => [
  file,
  parseAddedRanges(git(["diff", "-U0", "--no-color", `${base}...HEAD`, "--", file])),
 ]),
);

/** 落在本次改动行上的候选 error，按文件归组。 */
const candidates = new Map();

for (let index = 0; index < changed.length; index += BATCH) {
 // Windows 命令行上限约 32K 字符，一次传入几百个路径会失败，所以按批调用。
 const batch = changed.slice(index, index + BATCH);
 const result = spawnSync(
  process.execPath,
  [
   "x",
   "eslint",
   "--no-warn-ignored",
   "--no-error-on-unmatched-pattern",
   "-f",
   "json",
   ...batch,
  ],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
 );
 if (result.status === 2) {
  process.stderr.write(result.stderr);
  process.exit(2);
 }

 for (const file of JSON.parse(result.stdout || "[]")) {
  const absolute = file.filePath.replaceAll("\\", "/");
  const relative = changed.find(
   (candidate) => absolute === candidate || absolute.endsWith(`/${candidate}`),
  );
  if (!relative) continue;
  const own = ranges.get(relative) ?? [];
  for (const message of file.messages) {
   if (message.severity !== 2) continue;
   const line = message.line ?? 0;
   if (!own.some(([from, to]) => line >= from && line <= to)) continue;
   const list = candidates.get(relative) ?? [];
   list.push(message);
   candidates.set(relative, list);
  }
 }
}

const failures = [];
let deducted = 0;

for (const [file, own] of candidates) {
 const baselineText = gitShowOrNull(base, file);
 const baseline = baselineText === null ? [] : eslintErrors(file, baselineText);
 const remaining = dropPreExisting(own, baseline);
 deducted += own.length - remaining.length;
 for (const message of remaining) {
  failures.push(
   `${file}:${message.line ?? 0}:${message.column ?? 0} ${message.ruleId} ${message.message.split("\n")[0]}`,
  );
 }
}

if (failures.length > 0) {
 process.stderr.write(`[lint] ${failures.length} 个 error 落在改动行上\n`);
 for (const failure of failures) process.stderr.write(`${failure}\n`);
 process.exit(1);
}

process.stdout.write(
 `[lint] ${changed.length} 个改动文件，改动行上没有新增 error` +
 (deducted > 0 ? `（扣除基准已有的 ${deducted} 个）` : "") +
 "\n",
);
