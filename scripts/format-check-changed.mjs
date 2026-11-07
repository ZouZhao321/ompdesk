#!/usr/bin/env bun
/**
 * 只校验本次改动涉及的源码文件。
 *
 * 全仓库校验会把尚未排版的存量文件算进来，拆分后的分支单独运行必然失败；这里以基线
 * 分支的合并基点为参照，只检查本分支改动过的文件。基线取 `GITHUB_BASE_REF`，本地运行
 * 时取 `main`。
 *
 * git 调用一律显式传 `env: createGitEnv()`：钩子里注入的 `GIT_DIR` 一类变量会盖过
 * `-C`，让这些命令读到钩子所在仓库。
 */
import { spawnSync } from "node:child_process";
import { createGitEnv } from "../lib/git-env";

const baseRef = process.env.GITHUB_BASE_REF || "main";
const remoteRef = `origin/${baseRef}`;

/** 取基线分支与本分支的合并基点；取不到时返回 null。 */
function mergeBase() {
  const result = spawnSync("git", ["merge-base", remoteRef, "HEAD"], {
    encoding: "utf8",
    env: createGitEnv(),
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

let base = mergeBase();
if (!base) {
  spawnSync(
    "git",
    [
      "fetch",
      "--no-tags",
      "--depth=1",
      "origin",
      `+refs/heads/${baseRef}:refs/remotes/${remoteRef}`,
    ],
    {
      stdio: "inherit",
      env: createGitEnv(),
    },
  );
  base = mergeBase();
}

if (!base) {
  process.stderr.write(`[格式校验] 取不到基线 ${remoteRef} 的合并基点\n`);
  process.exit(1);
}

const diff = spawnSync("git", ["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`], {
  encoding: "utf8",
  env: createGitEnv(),
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

const result = spawnSync(process.execPath, ["x", "prettier", "--check", ...files], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
