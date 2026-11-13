#!/usr/bin/env bun
/**
 * 发版脚本。
 *
 *   bun scripts/release.ts feature       功能版本：次版本号加一，要求「未发布」里至少一条 feat 记录
 *   bun scripts/release.ts fix           修复版本：修订号加一，要求距上个修复版本已有两个功能版本且没有 feat 记录
 *   bun scripts/release.ts hotfix        紧急修复：修订号加一，不受功能版本数量限制
 *   bun scripts/release.ts 1.2.1         指定版本号：按与最新标签的差值校验记录类型，不做周期检查
 *   bun scripts/release.ts status        打印最近版本、已发功能版本数与下一步建议
 *   bun scripts/release.ts finish 1.2.1  合并后执行：打标签、推标签、建 GitHub Release、盯 CI
 *   bun scripts/release.ts ... --dry-run 只做检查并打印计划，不写文件、不推送
 *
 * 版本号只在准备阶段进入 main：标签由 finish 在版本已经合并后才创建，所以
 * publish-npm.yml 的“标签版本等于 package.json 版本”校验始终成立。
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { createGitEnv } from "../lib/git-env";

const ROOT = path.resolve(import.meta.dir, "..");
const PACKAGE_JSON = "package.json";
const CHANGELOG = "CHANGELOG.md";
const WORKTREE_ROOT = ".worktrees";
const TAG_PATTERN = "v[0-9]*";
const CI_WAIT_LIMIT_MS = 45 * 60 * 1000;
const CI_POLL_MS = 10_000;

type Bump = "major" | "minor" | "patch";
/** 发版类型：功能、定期修复、紧急修复、主版本。 */
type ReleaseKind = "feature" | "fix" | "hotfix" | "major";
/** 一个周期内的功能版本数量，达到后才可以发定期修复版本。 */
const FEATURES_PER_CYCLE = 2;

interface RunOptions {
  /** 命令的工作目录，默认仓库根。 */
  cwd?: string;
  /** 非零退出码不当作失败，由调用方判断。 */
  allowFailure?: boolean;
  /** 把子进程的输入输出直接接到当前终端，用于耗时命令。 */
  inherit?: boolean;
  /** 写进子进程标准输入的内容。 */
  stdin?: string;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface RunRow {
  databaseId: number;
  name: string;
  status: string;
  conclusion: string | null;
}

/** 版本号只接受三段数字，带不带 `v` 都可以；预发布后缀不接受。 */
export function normalizeVersion(input: string): string | null {
  const match = /^v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(input.trim());
  return match ? match[1] : null;
}

export function parseVersion(version: string): [number, number, number] {
  const normalized = normalizeVersion(version);
  if (!normalized) throw new Error(`版本号格式不对：${version}`);
  const [major, minor, patch] = normalized.split(".").map(Number);
  return [major, minor, patch];
}

export function bumpVersion(current: string, bump: Bump): string {
  const [major, minor, patch] = parseVersion(current);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

/** 与上一个版本相比的递增类型。 */
export function classifyVersion(version: string, previous: string): "major" | "feature" | "fix" | "same" {
  const current = parseVersion(version);
  const before = parseVersion(previous);
  if (current[0] !== before[0]) return "major";
  if (current[1] !== before[1]) return "feature";
  if (current[2] !== before[2]) return "fix";
  return "same";
}

/** 最近一次修复版本的版本号；没有修复版本时返回 null。修订号大于零即修复版本。 */
export function lastFixVersion(tags: string[]): string | null {
  const versions = [...new Set(tags.map((tag) => normalizeVersion(tag)).filter((v): v is string => v !== null))];
  versions.sort(compareVersions);
  const fixes = versions.filter((version) => parseVersion(version)[2] > 0);
  return fixes.length > 0 ? fixes[fixes.length - 1] : null;
}

/** 本周期已发布的功能记录数：最近一次修复版本之后各版本段落里的 feat 条目。 */
export function countCycleFeatures(content: string, tags: string[]): number {
  const lastFix = lastFixVersion(tags);
  let count = 0;
  for (const match of content.matchAll(/^## \[([0-9]+\.[0-9]+\.[0-9]+)\][^\n]*$/gm)) {
    const version = match[1];
    if (lastFix && compareVersions(version, lastFix) <= 0) continue;
    const section = extractChangelogSection(content, version);
    count += section.split("\n").filter((line) => /^-\s*feat(?:\([^)]*\))?[：:]/.test(line.trim())).length;
  }
  return count;
}

/** 「未发布」段落的起始位置与条目文本。 */
function unpublishedRange(content: string): { headingStart: number; bodyEnd: number; items: string } {
  const heading = /^## 未发布[^\n]*$/m.exec(content);
  if (!heading) throw new Error("CHANGELOG.md 里没有「## 未发布」段落");
  const headingStart = heading.index;
  const bodyStart = headingStart + heading[0].length;
  const next = /^## /m.exec(content.slice(bodyStart));
  const bodyEnd = next ? bodyStart + next.index : content.length;
  const items = content.slice(bodyStart, bodyEnd).trim();
  if (!items) throw new Error("「未发布」段落是空的，没有可发布的改动");
  return { headingStart, bodyEnd, items };
}

/** 「未发布」段落里的条目，每条以 `- ` 开头。 */
export function unpublishedEntries(content: string): string[] {
  return unpublishedRange(content)
    .items.split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));
}

/** 功能版本必须带 feat 记录，修复版本不能带 feat 记录；返回问题描述，没有问题时返回 null。 */
export function changelogKindProblem(kind: "feature" | "fix", content: string): string | null {
  const features = unpublishedEntries(content).filter((entry) => /^-\s*feat(?:\([^)]*\))?[：:]/.test(entry));
  if (kind === "feature" && features.length === 0) {
    return "功能版本要求「未发布」里至少有一条 feat 记录；只有修复时用 fix 或 hotfix";
  }
  if (kind === "fix" && features.length > 0) {
    return `修复版本不能包含 feat 记录：\n${features.join("\n")}`;
  }
  return null;
}

/**
 * 把「未发布」段落转成带日期的版本段落，并在它上面留一个空的「未发布」。
 * 段落为空时抛错：没有改动就不该发版。
 */
export function promoteChangelog(content: string, version: string, date: string): string {
  const { headingStart, bodyEnd, items } = unpublishedRange(content);
  const released = `## [${version}] - ${date}\n\n${items}\n\n`;
  const rest = content.slice(bodyEnd).replace(/^\n+/, "");
  return `${content.slice(0, headingStart)}## 未发布\n\n${released}${rest}`;
}

/** 取某个版本段落的内容，用作 GitHub Release 的说明。 */
export function extractChangelogSection(content: string, version: string): string {
  const prefix = `## [${version}]`;
  const heading = [...content.matchAll(/^## [^\n]*$/gm)].find((match) => match[0].startsWith(prefix));
  if (!heading) throw new Error(`CHANGELOG.md 里没有 ${version} 的段落`);
  const bodyStart = (heading.index ?? 0) + heading[0].length;
  const next = /^## /m.exec(content.slice(bodyStart));
  const bodyEnd = next ? bodyStart + next.index : content.length;
  return content.slice(bodyStart, bodyEnd).trim();
}

export function todayStamp(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fail(message: string): never {
  console.error(`\n失败：${message}`);
  process.exit(1);
}

function run(cmd: string[], options: RunOptions = {}): RunResult {
  const [file, ...args] = cmd;
  const proc = spawnSync(file, args, {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
    ...(options.stdin === undefined ? {} : { input: options.stdin }),
  });
  const result: RunResult = {
    code: proc.status ?? 1,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
  if (result.code !== 0 && !options.allowFailure) {
    const detail = result.stderr.trim();
    fail(`${cmd.join(" ")} 退出码 ${result.code}${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

/**
 * git 子进程。钩子注入的 GIT_DIR 一类变量会盖过 cwd，所以每个调用都传剥离后的环境。
 */
function git(args: string[], options: RunOptions = {}): RunResult {
  const proc = spawnSync("git", args, {
    cwd: options.cwd ?? ROOT,
    env: createGitEnv(),
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
  });
  const result: RunResult = {
    code: proc.status ?? 1,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
  if (result.code !== 0 && !options.allowFailure) {
    const detail = result.stderr.trim();
    fail(`git ${args.join(" ")} 退出码 ${result.code}${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function readPackageVersion(cwd = ROOT): string {
  const manifest = JSON.parse(fs.readFileSync(path.join(cwd, PACKAGE_JSON), "utf8")) as { version?: unknown };
  if (typeof manifest.version !== "string") fail(`${path.relative(ROOT, cwd) || "."}/package.json 没有 version 字段`);
  return manifest.version;
}

function writePackageVersion(cwd: string, version: string): void {
  const file = path.join(cwd, PACKAGE_JSON);
  const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  manifest.version = version;
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

function latestTag(): string {
  const tag = git(["describe", "--tags", "--abbrev=0", "--match", TAG_PATTERN], { allowFailure: true }).stdout.trim();
  if (!tag) return "0.0.0";
  const normalized = normalizeVersion(tag);
  if (!normalized) fail(`最新标签 ${tag} 不是版本标签`);
  return normalized;
}

function allTags(): string[] {
  return git(["tag", "--list", TAG_PATTERN])
    .stdout.split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** main 分支、工作区干净、HEAD 不落后于 origin/main。 */
function assertRepoState(): void {
  const branch = git(["branch", "--show-current"]).stdout.trim();
  if (branch !== "main") fail(`当前分支是「${branch || "分离 HEAD"}」，发版必须在 main 上执行`);
  const status = git(["status", "--porcelain"]).stdout.trim();
  if (status) fail(`工作区不干净，先提交或还原：\n${status}`);
  git(["fetch", "origin", "main", "--tags"]);
  const behind = run(["git", "merge-base", "--is-ancestor", "origin/main", "HEAD"], { allowFailure: true });
  if (behind.code !== 0) fail("HEAD 落后于 origin/main，先同步 main");
}

const RELEASE_KINDS: ReleaseKind[] = ["feature", "fix", "hotfix", "major"];

function resolveTarget(input: string, latest: string): { target: string; kind: ReleaseKind | null } {
  if (RELEASE_KINDS.includes(input as ReleaseKind)) {
    const kind = input as ReleaseKind;
    if (kind === "feature") return { target: bumpVersion(latest, "minor"), kind };
    if (kind === "major") return { target: bumpVersion(latest, "major"), kind };
    return { target: bumpVersion(latest, "patch"), kind };
  }
  const normalized = normalizeVersion(input);
  if (!normalized) fail(`版本号「${input}」不合法，写 1.2.1 这样的三段版本号，或 feature / fix / hotfix / major`);
  return { target: normalized, kind: null };
}

/** 指定版本号时按与最新标签的差值判断记录类型；跨主版本不检查记录。 */
export function inferContentKind(target: string, latest: string): "feature" | "fix" | null {
  const kind = classifyVersion(target, latest);
  if (kind === "major") return null;
  if (kind === "feature") return "feature";
  return "fix";
}

function assertTagAbsent(tag: string): void {
  if (git(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], { allowFailure: true }).code === 0) {
    fail(`本地已有标签 ${tag}`);
  }
  if (git(["ls-remote", "--tags", "origin", `refs/tags/${tag}`]).stdout.trim()) fail(`远端已有标签 ${tag}`);
}

function renderPrBody(version: string, section: string): string {
  return [
    "## What",
    "",
    `发布 ${version}：把 \`package.json\` 的版本与 \`CHANGELOG.md\` 的「未发布」段落固定为这个版本，没有其他改动。`,
    "",
    "## Why",
    "",
    `合并后执行 \`bun scripts/release.ts finish ${version}\` 打标签，标签与版本号因此始终一致。`,
    "",
    "## Testing",
    "",
    "提交经过 pre-commit 的类型检查，推送经过 `bun run verify:push` 的同一条流水线（typecheck → test → build → 开发冒烟）。",
    "",
    "---",
    "",
    "- [x] `bun run typecheck` 通过",
    "- [x] `bun test` 通过",
    "- [x] 涉及界面的改动已在浏览器实际操作验证（本次只改版本号与更新记录）",
    "",
    "## 发布内容",
    "",
    section,
    "",
  ].join("\n");
}

function cmdPrepare(input: string, dryRun: boolean): void {
  assertRepoState();

  const current = readPackageVersion();
  const latest = latestTag();
  if (normalizeVersion(current) !== latest) {
    fail(`package.json 的版本 ${current} 与最新标签 v${latest} 不一致，先对齐再发版`);
  }

  const { target, kind } = resolveTarget(input, latest);
  if (compareVersions(target, latest) <= 0) fail(`版本 ${target} 必须大于最新标签 ${latest}`);

  let contentKind: "feature" | "fix" | null = null;
  if (kind === "feature") contentKind = "feature";
  else if (kind === "fix" || kind === "hotfix") contentKind = "fix";
  else if (kind === null) contentKind = inferContentKind(target, latest);

  const changelogContent = fs.readFileSync(path.join(ROOT, CHANGELOG), "utf8");
  if (contentKind) {
    const problem = changelogKindProblem(contentKind, changelogContent);
    if (problem) fail(problem);
  }
  if (kind === "fix") {
    const shipped = countCycleFeatures(changelogContent, allTags());
    if (shipped < FEATURES_PER_CYCLE) {
      fail(`本周期只发布了 ${shipped} 条功能记录，定期修复至少要 ${FEATURES_PER_CYCLE} 条；紧急修复用 hotfix`);
    }
  }

  const tag = `v${target}`;
  assertTagAbsent(tag);

  if (run(["git", "check-ignore", "-q", `${WORKTREE_ROOT}/`], { allowFailure: true }).code !== 0) {
    fail(`${WORKTREE_ROOT}/ 没有被 Git 忽略，先写进 .gitignore 并提交`);
  }

  const today = todayStamp();
  const promoted = promoteChangelog(changelogContent, target, today);
  const section = extractChangelogSection(promoted, target);

  const branch = `chore/release-${target}`;
  const worktree = path.join(ROOT, WORKTREE_ROOT, branch);
  if (fs.existsSync(worktree)) fail(`${path.relative(ROOT, worktree)} 已存在，先清理`);

  if (dryRun) {
    console.log(`最新标签：v${latest}`);
    console.log(`目标版本：${target}`);
    console.log(`分支：${branch}`);
    console.log(`工作副本：${path.relative(ROOT, worktree)}`);
    console.log(`CHANGELOG.md：把「未发布」转为 [${target}] - ${today}`);
    console.log(`发布内容：\n${section}`);
    console.log("\n--dry-run 只做检查，没有写文件、没有推送。");
    return;
  }

  fs.mkdirSync(path.dirname(worktree), { recursive: true });
  git(["worktree", "add", worktree, "-b", branch, "origin/main"]);
  writePackageVersion(worktree, target);
  fs.writeFileSync(path.join(worktree, CHANGELOG), promoted);

  console.log("安装依赖，供提交钩子跑类型检查…");
  run(["bun", "install", "--frozen-lockfile"], { cwd: worktree, inherit: true });

  git(["add", PACKAGE_JSON, CHANGELOG], { cwd: worktree });
  git(
    [
      "commit",
      "-m",
      `chore(release): 发布 v${target}`,
      "-m",
      `把版本号与 CHANGELOG 的「未发布」段落固定为 ${target}。`,
    ],
    { cwd: worktree, inherit: true },
  );
  git(["push", "-u", "origin", branch], { cwd: worktree, inherit: true });
  const prUrl = run(
    [
      "gh",
      "pr",
      "create",
      "--base",
      "main",
      "--head",
      branch,
      "--title",
      `chore(release): 发布 v${target}`,
      "--body",
      renderPrBody(target, section),
    ],
    { cwd: worktree },
  ).stdout.trim();

  console.log(`\nPR：${prUrl}`);
  console.log(`\n合并后执行：\n  bun scripts/release.ts finish ${target}`);
}

function watchCI(sha: string, slug: string): void {
  const deadline = Date.now() + CI_WAIT_LIMIT_MS;
  let lastSummary = "";
  for (;;) {
    const listed = run(
      ["gh", "run", "list", "--commit", sha, "--limit", "20", "--json", "databaseId,name,status,conclusion"],
      { allowFailure: true },
    );
    const runs: RunRow[] = listed.code === 0 ? (JSON.parse(listed.stdout) as RunRow[]) : [];

    if (runs.length === 0) {
      console.log("等待 CI 启动…");
    } else {
      const failed = runs.filter(
        (row) => row.status === "completed" && row.conclusion !== "success" && row.conclusion !== "skipped",
      );
      if (failed.length > 0) {
        const lines = failed.map(
          (row) => `  ${row.name}：${row.conclusion} https://github.com/${slug}/actions/runs/${row.databaseId}`,
        );
        fail(`CI 未通过：\n${lines.join("\n")}`);
      }
      const pending = runs.filter((row) => row.status !== "completed");
      if (pending.length === 0) {
        console.log(`CI 全部通过（${runs.length} 条运行）`);
        return;
      }
      const summary = `CI 进行中：${runs.length - pending.length}/${runs.length}`;
      if (summary !== lastSummary) {
        console.log(summary);
        lastSummary = summary;
      }
    }

    if (Date.now() > deadline) fail("等待 CI 超过 45 分钟，到 Actions 页面确认结果");
    Bun.sleepSync(CI_POLL_MS);
  }
}

function cmdFinish(input: string, dryRun: boolean): void {
  const target = normalizeVersion(input);
  if (!target) fail(`版本号「${input}」不合法，写 1.2.1 或 v1.2.1`);

  assertRepoState();

  const current = readPackageVersion();
  if (normalizeVersion(current) !== target) {
    fail(`package.json 的版本是 ${current}，与 ${target} 不一致；先把发版 PR 合并到 main`);
  }

  const tag = `v${target}`;
  assertTagAbsent(tag);

  const section = extractChangelogSection(fs.readFileSync(path.join(ROOT, CHANGELOG), "utf8"), target);
  const sha = git(["rev-parse", "HEAD"]).stdout.trim();
  const slug = git(["remote", "get-url", "origin"])
    .stdout.trim()
    .replace(/^.*github\.com[:/]/, "")
    .replace(/\.git$/, "");

  if (dryRun) {
    console.log(`提交：${sha.slice(0, 8)}`);
    console.log(`标签：${tag}`);
    console.log(`仓库：${slug}`);
    console.log(`发布说明：\n${section}`);
    console.log("\n--dry-run 只做检查，没有打标签、没有推送。");
    return;
  }

  git(["tag", "-a", tag, "-m", tag]);
  git(["push", "origin", `refs/tags/${tag}`], { inherit: true });

  console.log(`\n已推出 ${tag}，等远端 CI 打包并建 Release，然后盯 CI…`);
  watchCI(sha, slug);
  console.log(`\n${tag} 发布完成。`);
}

function cmdStatus(): void {
  const tags = allTags();
  const versions = [...new Set(tags.map((tag) => normalizeVersion(tag)).filter((v): v is string => v !== null))];
  versions.sort(compareVersions);
  if (versions.length === 0) {
    console.log("还没有版本标签");
    return;
  }

  console.log("最近版本：");
  for (let i = Math.max(versions.length - 6, 0); i < versions.length; i++) {
    const kind =
      i === 0 ? (parseVersion(versions[0])[2] > 0 ? "fix" : "initial") : classifyVersion(versions[i], versions[i - 1]);
    console.log(`  ${versions[i]}\t${kind}`);
  }

  const shipped = countCycleFeatures(fs.readFileSync(path.join(ROOT, CHANGELOG), "utf8"), tags);
  console.log(`\n本周期已发布的功能记录：${shipped}`);
  if (shipped >= FEATURES_PER_CYCLE) {
    console.log(`下一步：fix（本周期功能记录已达到 ${FEATURES_PER_CYCLE} 条）`);
  } else {
    console.log(`下一步：feature（本周期还需 ${FEATURES_PER_CYCLE - shipped} 条功能记录才能发定期修复）`);
  }
  console.log("紧急修复随时可用 hotfix。");
}

function cmdNotes(input: string): void {
  const target = normalizeVersion(input);
  if (!target) fail(`版本号「${input}」不合法，写 1.2.1 或 v1.2.1`);
  const section = extractChangelogSection(fs.readFileSync(path.join(ROOT, CHANGELOG), "utf8"), target);
  process.stdout.write(`${section}\n`);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const args = argv.filter((arg) => arg !== "--dry-run");
  const [command, value] = args;

  if (!command || command === "--help" || command === "help") {
    console.error(`用法：
  bun scripts/release.ts feature                    功能版本：次版本号加一，要求有 feat 记录
  bun scripts/release.ts fix                        定期修复：两个功能版本之后的修订号加一
  bun scripts/release.ts hotfix                     紧急修复：随时可用，修订号加一
  bun scripts/release.ts major                      主版本：大版本号加一
  bun scripts/release.ts <版本>                     指定版本号，按差值校验记录类型
  bun scripts/release.ts status                     最近版本、功能版本数与下一步建议
  bun scripts/release.ts finish <版本>              合并后打标签、推标签、盯 CI
  bun scripts/release.ts notes <版本>               打印这一版的更新记录，供 CI 生成 Release 说明
  bun scripts/release.ts ... --dry-run              只检查并打印计划`);
    process.exit(command ? 0 : 1);
  }
  if (command === "finish") {
    if (!value) fail("finish 需要版本号");
    cmdFinish(value, dryRun);
  } else if (command === "notes") {
    if (!value) fail("notes 需要版本号");
    cmdNotes(value);
  } else if (command === "status") {
    cmdStatus();
  } else {
    cmdPrepare(command, dryRun);
  }
}
