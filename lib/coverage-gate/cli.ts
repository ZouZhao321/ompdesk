import { readFile } from "node:fs/promises";
import {
  isManagedSourceFile,
  listChangedFiles,
  listManagedSourceFiles,
  repositoryRoot,
  resolveMergeBase,
  type ChangedFile,
} from "./git";
import { aggregateCoverage, indexByPath, parseLcov } from "./lcov";
import { renderReport } from "./report";
import { evaluateRules } from "./rules";

/** git 查询的注入点：命令行用默认实现，测试用固定样本，不读真实仓库状态。 */
export interface GitQueries {
  repositoryRoot(cwd: string): Promise<string>;
  mergeBase(cwd: string, baseRef: string): Promise<string>;
  changedFiles(cwd: string, mergeBase: string): Promise<ChangedFile[]>;
  managedSourceFiles(cwd: string): Promise<string[]>;
}

const GIT_QUERIES: GitQueries = {
  repositoryRoot,
  mergeBase: resolveMergeBase,
  changedFiles: listChangedFiles,
  managedSourceFiles: listManagedSourceFiles,
};

export interface CoverageGateOptions {
  cwd: string;
  /** lcov 产物路径，由测试命令的 `--coverage-dir` 决定。 */
  lcovPath: string;
  /** 合并目标分支，默认 `origin/main`。 */
  baseRef?: string;
}

export interface CoverageGateDependencies {
  readText?: (filePath: string) => Promise<string>;
  git?: GitQueries;
}

export interface CoverageGateResult {
  /** 本票据只报告，任何结论都是 0；规则阻断在后续票据接入。 */
  exitCode: number;
  report: string;
}

export const DEFAULT_BASE_REF = "origin/main";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function renderUnavailable(detail: string): string {
  return [
    "覆盖率门禁未能运行",
    `  ${detail}`,
    "  本步骤只报告，退出码保持 0。",
  ].join("\n");
}

/**
 * 编排一次门禁运行：读 lcov、取分叉点与改动清单、聚合、渲染报告。
 *
 * 产物缺失或 git 读不到分叉点时把原因写进报告而不是抛出：本票据的步骤不改变合并
 * 结论，日志里要留下可定位的说明。规则判定结果同样只进报告。
 */
export async function runCoverageGate(
  options: CoverageGateOptions,
  dependencies: CoverageGateDependencies = {},
): Promise<CoverageGateResult> {
  const readText = dependencies.readText ?? ((filePath: string) => readFile(filePath, "utf8"));
  const git = dependencies.git ?? GIT_QUERIES;
  const baseRef = options.baseRef ?? DEFAULT_BASE_REF;

  let lcovText: string;
  try {
    lcovText = await readText(options.lcovPath);
  } catch (error) {
    return {
      exitCode: 0,
      report: renderUnavailable(
        `覆盖率产物缺失：${options.lcovPath}（${errorMessage(error)}）。`
          + "先运行 bun run coverage:gate 生成 lcov。",
      ),
    };
  }

  const parsed = parseLcov(lcovText);
  const coverage = indexByPath(parsed.files);
  const totals = aggregateCoverage(parsed.files);

  let mergeBase: string;
  let changedFiles: ChangedFile[];
  let managedFiles: string[];
  try {
    const root = await git.repositoryRoot(options.cwd);
    mergeBase = await git.mergeBase(options.cwd, baseRef);
    [changedFiles, managedFiles] = await Promise.all([
      git.changedFiles(root, mergeBase),
      git.managedSourceFiles(root),
    ]);
  } catch (error) {
    return {
      exitCode: 0,
      report: renderUnavailable(
        `git 数据读取失败：${errorMessage(error)}。`
          + "分叉点需要完整检出，actions/checkout 需设 fetch-depth: 0。",
      ),
    };
  }

  const relevantChanges = changedFiles.filter((file) => isManagedSourceFile(file.path));
  const report = renderReport({
    baseRef,
    mergeBase,
    changedFiles: relevantChanges,
    coverage,
    totals,
    droppedRecords: parsed.dropped.length,
    duplicateRecords: parsed.duplicates,
    managedFileCount: managedFiles.length,
    missingManagedFiles: managedFiles.filter((file) => !coverage.has(file)),
    findings: evaluateRules({
      changedFiles: relevantChanges,
      coverage,
      totals,
      managedFiles,
    }),
  });

  return { exitCode: 0, report };
}
