#!/usr/bin/env bun
/**
 * 只校验本次改动涉及的源码文件。
 *
 * 全仓库校验会把尚未排版的存量文件算进来，拆分后的每个 PR 单独运行必然失败；
 * 这里以基线分支为参照，只检查本分支改动过的文件。基线取 `GITHUB_BASE_REF`，
 * 本地运行时取 `origin/main`。
 */
import { spawnSync } from "node:child_process";
import { createGitEnv } from "../lib/git-env";

const env = createGitEnv();
const baseRef = process.env.GITHUB_BASE_REF || "main";
const remoteRef = `origin/${baseRef}`;

function mergeBase() {
  const result = spawnSync("git", ["merge-base", remoteRef, "HEAD"], { encoding: "utf8", env });
  return result.status === 0 ? result.stdout.trim() : null;
}

if (!mergeBase()) {
  spawnSync(
    "git",
    [
      "fetch",
      "--no-tags",
      "--depth=1",
      "origin",
      `+refs/heads/${baseRef}:refs/remotes/${remoteRef}`,
    ],
    { stdio: "inherit", env },
  );
}

const base = mergeBase();
if (!base) {
  process.stderr.write(`[格式校验] 取不到基线 ${remoteRef} 的合并基点\n`);
  process.exit(1);
}

const diff = spawnSync("git", ["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`], {
  encoding: "utf8",
  env,
});
if (diff.status !== 0) process.exit(diff.status ?? 1);

const files = diff.stdout
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => /\.(ts|tsx|mjs|css|json)$/.test(line));

if (files.length === 0) {
  process.stdout.write("[格式校验] 本次改动没有需要校验的源码文件\n");
  process.exit(0);
}

const result = spawnSync("./node_modules/.bin/prettier", ["--check", ...files], {
  stdio: "inherit",
  env,
});
process.exit(result.status ?? 1);
