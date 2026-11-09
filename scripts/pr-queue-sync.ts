#!/usr/bin/env bun
/**
 * 把 origin/main 合进比 main 旧的开放 PR 分支，让必需检查重新开始上报。
 *
 * 只处理能干净合并的分支；冲突的跳过并列出。默认只打印计划，加 `--apply` 才执行。
 *
 * 每个分支必须在自己的 worktree 里合并与推送：仓库的 pre-push 钩子会跑一整套
 * 校验（类型检查、测试、构建、开发冒烟），它校验的是当前工作区的代码。在别处
 * 造合并提交再推，校验的就不是要推的内容。
 *
 * 用法：bun run queue:sync [--apply] [-- 只处理这些编号]
 */

import { execFileSync } from "node:child_process";
import { createGitEnv } from "../lib/git-env";

interface Worktree {
  path: string;
  branch: string;
}

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    env: createGitEnv(),
  });
}

function tryGit(args: string[], cwd?: string): { ok: boolean; stdout: string } {
  try {
    return { ok: true, stdout: git(args, cwd) };
  } catch (error) {
    const failure = error as { stdout?: string };
    return { ok: false, stdout: failure.stdout ?? "" };
  }
}

function worktrees(): Worktree[] {
  const lines = git(["worktree", "list", "--porcelain"]).split("\n");
  const result: Worktree[] = [];
  let path = "";
  for (const line of lines) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    if (line.startsWith("branch refs/heads/")) {
      result.push({ path, branch: line.slice("branch refs/heads/".length) });
    }
  }
  return result;
}

const apply = process.argv.includes("--apply");
const only = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith("--"))
  .map((arg) => Number(arg.replace(/^#/, "")))
  .filter((value) => Number.isInteger(value));

git(["fetch", "origin", "--prune", "--quiet"]);

const listed = JSON.parse(
  execFileSync("gh", ["pr", "list", "--state", "open", "--limit", "100", "--json", "number,headRefName"], {
    encoding: "utf8",
    env: createGitEnv(),
  }),
) as { number: number; headRefName: string }[];

const byBranch = new Map(worktrees().map((worktree) => [worktree.branch, worktree.path]));
const report: string[] = [];
const skipped: string[] = [];

for (const pr of listed) {
  if (only.length > 0 && !only.includes(pr.number)) continue;
  const branch = pr.headRefName;
  const behindResult = tryGit(["rev-list", "--count", `origin/${branch}..origin/main`]);
  if (!behindResult.ok) {
    skipped.push(`#${pr.number} ${branch}：读不到 origin/${branch}，无法判断是否落后`);
    continue;
  }
  const behind = Number(behindResult.stdout.trim());
  if (behind === 0) {
    skipped.push(`#${pr.number} ${branch}：已是最新`);
    continue;
  }

  const worktree = byBranch.get(branch);
  if (!worktree) {
    skipped.push(`#${pr.number} ${branch}：没有检出该分支的 worktree，无法在钩子校验下推送`);
    continue;
  }

  const status = git(["status", "--porcelain"], worktree).trim();
  if (status.length > 0) {
    skipped.push(`#${pr.number} ${branch}：worktree 有未提交改动，先处理再同步`);
    continue;
  }

  const merged = tryGit(["merge-tree", "--write-tree", `origin/${branch}`, "origin/main"]);
  if (!merged.ok) {
    const files = [
      ...new Set([...merged.stdout.matchAll(/CONFLICT \([^)]*\): (?:.*? in )?(\S+)/g)].map((match) => match[1])),
    ];
    skipped.push(`#${pr.number} ${branch}：与 main 冲突（${files.join("、") || "原因未知"}），需要人工解决`);
    continue;
  }

  const plan = `#${pr.number} ${branch}：比 main 少 ${behind} 个提交，可干净合并`;
  if (!apply) {
    report.push(`${plan}（未执行，加 --apply）`);
    continue;
  }

  git(["merge", "--no-edit", "origin/main"], worktree);
  git(["push", "--quiet", "origin", `HEAD:refs/heads/${branch}`], worktree);
  report.push(`#${pr.number} ${branch}：已合并 main 并推送`);
}

for (const line of report) process.stdout.write(`${line}\n`);
if (skipped.length > 0) {
  process.stdout.write("\n未处理：\n");
  for (const line of skipped) process.stdout.write(`- ${line}\n`);
}
