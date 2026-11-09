/**
 * 分叉点的基准覆盖率与两版文件正文。
 *
 * 基准数据现场生成，不缓存：每次运行都在仓库的 `.tmp` 下新建一个分叉点的工作副本
 * （`git worktree`），用与本次相同的一条测试命令产出 lcov，读完即删。代价是每个合并
 * 请求多一次测试运行，换来的是基准永远与当前分叉点一致，不会复用上一次运行的结果。
 *
 * 工作副本放在仓库内的 `.tmp/` 下，`node_modules` 由上层目录解析到，不额外安装依赖。
 * 失败时不抛异常，返回带原因的失败结果：基准缺失是流水线问题，规则要把原因报出来，
 * 不能当作通过。
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createGitEnv } from "../git-env";
import { readFileAtRevision, type ChangedFile } from "./git";
import { indexByPath, parseLcov, type FileCoverage } from "./lcov";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 60_000;
const BASE_TEST_TIMEOUT_MS = 180_000;
const MAX_BUFFER = 64 * 1024 * 1024;
const LCOV_FILE_NAME = "lcov.info";

/** 基准运行用的测试命令与本次覆盖率一致，产物目录由调用方给出。 */
const BASE_TEST_ARGS = ["test", "--coverage", "--coverage-reporter=lcov"];

interface BaseCoverageRequest {
  /** 仓库根目录，工作副本登记在它名下；`.tmp` 也在它下面。 */
  repositoryRoot: string;
  /** 分叉点提交。 */
  mergeBase: string;
  /** 工作副本的父目录，通常是 `<仓库根>/.tmp/coverage-gate-base`。 */
  scratchRoot: string;
}

interface BaseCoverageSuccess {
  ok: true;
  coverage: ReadonlyMap<string, FileCoverage>;
  /** 基准运行耗时，毫秒；报告里给出，便于核对门禁的时间预算。 */
  durationMs: number;
  /** 基准运行时使用的工作副本，删掉之前写进日志。 */
  worktreePath: string;
}

interface BaseCoverageFailure {
  ok: false;
  /** 失败原因，直接进报告；不含实现层堆栈。 */
  detail: string;
  durationMs: number;
}

export type BaseCoverageResult = BaseCoverageSuccess | BaseCoverageFailure;

export type BaseCoverageLoader = (request: BaseCoverageRequest) => Promise<BaseCoverageResult>;

/** 一次改动文件的基准侧与本次侧正文；版本里不存在时为 null。 */
export interface SourcePair {
  base: string | null;
  head: string | null;
}

export type SourceReader = (repositoryRoot: string, mergeBase: string, file: ChangedFile) => Promise<SourcePair>;

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const stderr = (error as Error & { stderr?: string }).stderr;
  const detail = stderr && stderr.trim() ? stderr.trim().split(/\r?\n/).slice(-3).join(" ") : error.message;
  return detail;
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    env: createGitEnv(),
  });
}

/**
 * 建分叉点工作副本、跑测试、读 lcov。任何一步失败都返回失败结果并说明是哪一步，
 * 工作副本建出来后必定删掉，失败时也不留下垃圾。
 */
export async function generateBaseCoverage(request: BaseCoverageRequest): Promise<BaseCoverageResult> {
  const startedAt = Date.now();
  const worktreePath = path.join(
    request.scratchRoot,
    `${request.mergeBase.slice(0, 12)}-${process.pid}-${startedAt.toString(36)}`,
  );
  const coverageDir = path.join(worktreePath, ".coverage-base");
  const baseLabel = request.mergeBase.slice(0, 7);
  const elapsed = (): number => Date.now() - startedAt;

  try {
    await mkdir(request.scratchRoot, { recursive: true });
  } catch (error) {
    return {
      ok: false,
      detail: `无法创建工作副本目录 ${request.scratchRoot}：${errorMessage(error)}`,
      durationMs: elapsed(),
    };
  }

  try {
    try {
      await git(request.repositoryRoot, ["worktree", "add", "--detach", worktreePath, request.mergeBase]);
    } catch (error) {
      return {
        ok: false,
        detail: `无法为分叉点 ${baseLabel} 创建工作副本：${errorMessage(error)}`,
        durationMs: elapsed(),
      };
    }

    try {
      await execFileAsync(
        // 门禁本身在 bun 下运行，基准运行直接复用当前进程的可执行文件。
        process.versions.bun ? process.execPath : "bun",
        [...BASE_TEST_ARGS, `--coverage-dir=${coverageDir}`],
        { cwd: worktreePath, timeout: BASE_TEST_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
      );
    } catch (error) {
      return {
        ok: false,
        detail: `分叉点 ${baseLabel} 的测试运行失败：${errorMessage(error)}`,
        durationMs: elapsed(),
      };
    }

    let lcovText: string;
    try {
      lcovText = await readFile(path.join(coverageDir, LCOV_FILE_NAME), "utf8");
    } catch (error) {
      return {
        ok: false,
        detail:
          `分叉点 ${baseLabel} 的覆盖率产物缺失：` +
          `${path.join(coverageDir, LCOV_FILE_NAME)}（${errorMessage(error)}）`,
        durationMs: elapsed(),
      };
    }

    const parsed = parseLcov(lcovText);
    return {
      ok: true,
      coverage: indexByPath(parsed.files),
      durationMs: elapsed(),
      worktreePath,
    };
  } finally {
    // 清理是尽力而为：删不掉的工作副本登记由 prune 清掉，清理问题只在终端上说明，
    // 不替换已经得出的判定结果。
    const problems = await discardWorktree(request.repositoryRoot, worktreePath);
    if (problems.length > 0) console.error("[ompdesk] 覆盖率门禁清理工作副本失败：", problems.join("；"));
  }
}

/**
 * 删工作副本再 prune，删不掉的残留登记由 prune 清掉。返回清理期间遇到的问题，
 * 由调用方决定记在哪里。
 */
async function discardWorktree(repositoryRoot: string, worktreePath: string): Promise<string[]> {
  const problems: string[] = [];
  try {
    await rm(worktreePath, { recursive: true, force: true });
  } catch (error) {
    problems.push(`工作副本残留未删除：${errorMessage(error)}`);
  }
  try {
    await git(repositoryRoot, ["worktree", "prune"]);
  } catch (error) {
    problems.push(`工作副本登记清理失败：${errorMessage(error)}`);
  }
  return problems;
}

/** 这些读取失败说明该版本的正文本身缺席或不可读，交给规则二判定；其余错误照常抛出。 */
const UNREADABLE_CODES: Record<string, true> = {
  ENOENT: true,
  EISDIR: true,
  ENOTDIR: true,
  EACCES: true,
  EPERM: true,
  ELOOP: true,
};

async function readWorkingTreeFile(absolutePath: string): Promise<string | null> {
  try {
    return await readFile(absolutePath, "utf8");
  } catch (error) {
    if (UNREADABLE_CODES[(error as NodeJS.ErrnoException).code ?? ""] === true) return null;
    throw error;
  }
}

/** 读一个改动文件的两版正文：分叉点版本走 git，本次版本取工作区。 */
export async function readSourcePair(
  repositoryRoot: string,
  mergeBase: string,
  file: ChangedFile,
): Promise<SourcePair> {
  const basePath = file.previousPath ?? file.path;
  const [base, head] = await Promise.all([
    readFileAtRevision(repositoryRoot, mergeBase, basePath),
    readWorkingTreeFile(path.join(repositoryRoot, file.path)),
  ]);
  return { base, head };
}
