#!/usr/bin/env bun
/**
 * 校验 PR 里每个提交的标题。
 *
 * 本地 `commit-msg` 钩子只保护装了钩子的机器，外部贡献者的提交会绕过它。
 * 校验规则不在这里重写一份：逐条标题交给 `scripts/check-commit-msg.py`，
 * 标题格式只有那一处来源。
 *
 * 基线取 `PR_BASE_SHA`（CI 传 `github.event.pull_request.base.sha`）。
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitEnv } from "../lib/git-env.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORK = join(ROOT, ".tmp", "pr-titles");
const CHECKER = join(ROOT, "scripts", "check-commit-msg.py");
const PYTHON =
  process.env.PYTHON?.trim() ||
  (process.platform === "win32" ? "python" : "python3");

const base = process.env.PR_BASE_SHA?.trim();
if (!base) {
  process.stderr.write("缺少 PR_BASE_SHA：提交标题检查需要合并基线\n");
  process.exit(2);
}

const log = spawnSync("git", ["log", "--format=%H%x1f%s", `${base}..HEAD`], {
  cwd: ROOT,
  encoding: "utf8",
  env: createGitEnv(),
  maxBuffer: 16 * 1024 * 1024,
});
if (log.status !== 0) {
  process.stderr.write(log.stderr);
  process.exit(log.status ?? 1);
}

const commits = log.stdout
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [sha, subject] = line.split("\x1f");
    return { sha, subject };
  });

if (commits.length === 0) {
  process.stdout.write("[titles] 没有新增提交\n");
  process.exit(0);
}

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

const failures = [];
for (const commit of commits) {
  const file = join(WORK, `${commit.sha}.txt`);
  writeFileSync(file, `${commit.subject}\n`, "utf8");
  const result = spawnSync(PYTHON, [CHECKER, file], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status === 2) {
    process.stderr.write(result.stderr);
    rmSync(WORK, { recursive: true, force: true });
    process.exit(2);
  }
  if (result.status !== 0) {
    failures.push(
      `${commit.sha.slice(0, 7)} ${commit.subject}\n${result.stderr.trim()}`,
    );
  }
}

rmSync(WORK, { recursive: true, force: true });

if (failures.length > 0) {
  process.stderr.write(`[titles] ${failures.length} 个提交标题不合规\n`);
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.exit(1);
}

process.stdout.write(`[titles] ${commits.length} 个提交标题合规\n`);
