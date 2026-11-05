import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  generateBaseCoverage,
  readSourcePair,
  type BaseCoverageLoader,
  type SourceReader,
} from "./base-coverage";
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
import { buildFunctionDelta, type FunctionDeltaData } from "./rules/rule-function-delta";

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
  /** 分叉点基准覆盖率的获取；命令行默认现场生成，测试注入固定样本。 */
  baseCoverage?: BaseCoverageLoader;
  /** 改动文件两版正文的读取；命令行默认走 git 与工作区，测试注入固定样本。 */
  sources?: SourceReader;
}

export interface CoverageGateResult {
  /** 有规则判定结果时为 1，没有判定结果时为 0。 */
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
    "  没有判定结果，退出码为 0。",
  ].join("\n");
}

/**
 * 编排一次门禁运行：读 lcov、取分叉点与改动清单、现场生成基准覆盖率、聚合、判定、
 * 渲染报告。
 *
 * 产物缺失或 git 读不到分叉点时把原因写进报告而不是抛出：日志里要留下可定位的说明，
 * 这种情况下没有判定结果，退出码为 0。基准运行失败不在此列，它由规则二报成流水线问题
 * 并参与退出码。
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

  let root: string;
  let mergeBase: string;
  let changedFiles: ChangedFile[];
  let managedFiles: string[];
  try {
    root = await git.repositoryRoot(options.cwd);
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

  // 规则二只判改动过的文件：新增文件走规则一，没有可判的文件时不跑基准，省一次测试运行。
  const deltaFiles = relevantChanges.filter((file) => file.status !== "added");
  let functionDelta: FunctionDeltaData | undefined;
  if (deltaFiles.length > 0) {
    const [baseCoverage, pairs] = await Promise.all([
      (dependencies.baseCoverage ?? generateBaseCoverage)({
        repositoryRoot: root,
        mergeBase,
        scratchRoot: path.join(root, ".tmp", "coverage-gate-base"),
      }),
      Promise.all(
        deltaFiles.map(async (file) => {
          const pair = await (dependencies.sources ?? readSourcePair)(root, mergeBase, file);
          return [file.path, pair] as const;
        }),
      ),
    ]);
    functionDelta = buildFunctionDelta({
      changedFiles: deltaFiles,
      coverage,
      baseCoverage,
      mergeBase,
      sources: new Map(pairs),
    });
  }

  const findings = evaluateRules({
    changedFiles: relevantChanges,
    coverage,
    totals,
    managedFiles,
    functionDelta,
  });

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
    functionDelta,
    findings,
  });

  return { exitCode: findings.length > 0 ? 1 : 0, report };
}
