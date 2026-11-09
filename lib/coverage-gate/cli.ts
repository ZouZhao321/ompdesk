import { readFile } from "node:fs/promises";
import path, { join } from "node:path";
import { generateBaseCoverage, readSourcePair, type BaseCoverageLoader, type SourceReader } from "./base-coverage";
import { BASELINE_FILE, collectExportUsage, exportUsageFailure, type ExportAnalysis } from "./exports";
import {
  isManagedSourceFile,
  listChangedFiles,
  listDeletedFiles,
  listManagedSourceFiles,
  listTestFiles,
  readFileAtRevision,
  repositoryRoot,
  resolveMergeBase,
  type ChangedFile,
} from "./git";
import { aggregateCoverage, indexByPath, parseLcov } from "./lcov";
import { renderReport } from "./report";
import { evaluateRules } from "./rules";
import { buildFunctionDelta, type FunctionDeltaData } from "./rules/rule-function-delta";
import { collectTestImports } from "./test-imports";

/** git 查询的注入点：命令行用默认实现，测试用固定样本，不读真实仓库状态。 */
export interface GitQueries {
  repositoryRoot(cwd: string): Promise<string>;
  mergeBase(cwd: string, baseRef: string): Promise<string>;
  changedFiles(cwd: string, mergeBase: string): Promise<ChangedFile[]>;
  managedSourceFiles(cwd: string): Promise<string[]>;
  /** 测试文件清单；注入的桩没有这一项时被动覆盖检查跳过。 */
  testFiles?(cwd: string): Promise<string[]>;
  /** 分叉点以来被删除的受管源文件；桩没有这一项时按没有删除处理。 */
  deletedFiles?(cwd: string, mergeBase: string): Promise<string[]>;
}

const GIT_QUERIES: GitQueries = {
  repositoryRoot,
  mergeBase: resolveMergeBase,
  changedFiles: listChangedFiles,
  managedSourceFiles: listManagedSourceFiles,
  testFiles: listTestFiles,
  deletedFiles: listDeletedFiles,
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
  /** 读取分叉点版本的文件；文件在该版本不存在时返回 null。 */
  readBaseText?: (root: string, revision: string, filePath: string) => Promise<string | null>;
  /** 读取基线文件；不存在时返回 null，解析交给规则。 */
  readBaseline?: (root: string) => Promise<string | null>;
  git?: GitQueries;
  /** 分叉点基准覆盖率的获取；命令行默认现场生成，测试注入固定样本。 */
  baseCoverage?: BaseCoverageLoader;
  /** 改动文件两版正文的读取；命令行默认走 git 与工作区，测试注入固定样本。 */
  sources?: SourceReader;
}

export interface CoverageGateResult {
  /** 有判定结果时非零，用来让合并检查变红；产物或 git 数据不可用时保持 0。 */
  exitCode: number;
  report: string;
}

export const DEFAULT_BASE_REF = "origin/main";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function renderUnavailable(detail: string): string {
  return ["覆盖率门禁未能运行", `  ${detail}`, "  没有判定结果，退出码为 0。"].join("\n");
}

/**
 * 测试文件的导入索引。git 查询的桩没有 `testFiles` 时返回 undefined，被动覆盖检查随之跳过：
 * 空索引会被当成「没有任何测试导入过这个符号」，与桩缺少这项查询的语义相反。
 */
async function collectTestImportIndex(
  git: GitQueries,
  root: string,
  readText: (filePath: string) => Promise<string>,
): Promise<ReadonlyMap<string, ReadonlySet<string>> | undefined> {
  if (!git.testFiles) return undefined;

  const testFiles = await git.testFiles(root);
  const sources = new Map<string, string>();
  await Promise.all(
    testFiles.map(async (filePath) => {
      try {
        sources.set(filePath, await readText(join(root, filePath)));
      } catch (error) {
        // git 索引里仍列着工作区已删除的文件，缺文件不该让整次门禁退化成「未能运行」。
        if (!isMissingFile(error)) throw new Error(`${filePath}：${errorMessage(error)}`);
      }
    }),
  );
  return collectTestImports(sources);
}

/**
 * 分叉点有、本次已删除的受管源文件的正文。改名与拆分的函数名对应要拿它和新增文件比。
 */
async function readDeletedSources(
  deletedFiles: readonly string[],
  root: string,
  mergeBase: string,
  readBaseText: (root: string, revision: string, filePath: string) => Promise<string | null>,
): Promise<ReadonlyMap<string, string>> {
  const sources = new Map<string, string>();
  const texts = await Promise.all(
    deletedFiles.map(async (filePath) => [filePath, await readBaseText(root, mergeBase, filePath)] as const),
  );
  for (const [filePath, text] of texts) {
    if (text !== null) sources.set(filePath, text);
  }
  return sources;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function readBaselineFile(root: string): Promise<string | null> {
  try {
    return await readFile(join(root, BASELINE_FILE), "utf8");
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

/**
 * 编排一次门禁运行：读 lcov、取分叉点与改动清单、现场生成基准覆盖率、聚合、判定、
 * 渲染报告。
 *
 * 产物缺失或 git 读不到分叉点时把原因写进报告而不是抛出，退出码保持 0：门禁本身
 * 没跑起来不等于代码没被测试。规则有判定结果时退出码为 1，检查随之变红。基准运行
 * 失败由规则二报成流水线问题，导出分析失败由规则三报成流水线问题，两者都参与退出码：
 * 数据不全时放过合并，等于把「没读到引用」当成「没有引用」。
 */
export async function runCoverageGate(
  options: CoverageGateOptions,
  dependencies: CoverageGateDependencies = {},
): Promise<CoverageGateResult> {
  const readText = dependencies.readText ?? ((filePath: string) => readFile(filePath, "utf8"));
  const readBaseText = dependencies.readBaseText ?? readFileAtRevision;
  const readBaseline = dependencies.readBaseline ?? readBaselineFile;
  const git = dependencies.git ?? GIT_QUERIES;
  const baseRef = options.baseRef ?? DEFAULT_BASE_REF;

  let lcovText: string;
  try {
    lcovText = await readText(options.lcovPath);
  } catch (error) {
    return {
      exitCode: 0,
      report: renderUnavailable(
        `覆盖率产物缺失：${options.lcovPath}（${errorMessage(error)}）。` + "先运行 bun run coverage:gate 生成 lcov。",
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
  let deletedFiles: string[];
  try {
    root = await git.repositoryRoot(options.cwd);
    mergeBase = await git.mergeBase(options.cwd, baseRef);
    [changedFiles, managedFiles, deletedFiles] = await Promise.all([
      git.changedFiles(root, mergeBase),
      git.managedSourceFiles(root),
      git.deletedFiles ? git.deletedFiles(root, mergeBase) : Promise.resolve([]),
    ]);
  } catch (error) {
    return {
      exitCode: 0,
      report: renderUnavailable(
        `git 数据读取失败：${errorMessage(error)}。` + "分叉点需要完整检出，actions/checkout 需设 fetch-depth: 0。",
      ),
    };
  }

  const relevantChanges = changedFiles.filter((file) => isManagedSourceFile(file.path));

  let exportUsage: ExportAnalysis;
  try {
    exportUsage = await collectExportUsage({
      changedFiles: relevantChanges,
      managedFiles,
      readers: {
        readWorkspace: (filePath) => readText(join(root, filePath)),
        readAtMergeBase: (filePath) => readBaseText(root, mergeBase, filePath),
      },
      baselineText: await readBaseline(root),
    });
  } catch (error) {
    // 分析整体失败也走规则：规则三把它报成流水线问题，规则一与规则二的判定照常输出。
    exportUsage = exportUsageFailure(`导出引用分析失败：${errorMessage(error)}`);
  }

  let testImports: ReadonlyMap<string, ReadonlySet<string>> | undefined;
  try {
    testImports = await collectTestImportIndex(git, root, readText);
  } catch (error) {
    return {
      exitCode: 0,
      report: renderUnavailable(`测试文件导入语句读取失败：${errorMessage(error)}。`),
    };
  }

  // 改名、拆分与替换的识别要看两侧函数名：有改动的非新增文件，或有新增文件而又删了文件
  // （拆分与合一的形状）时才取基准，其余情形省一次测试运行。
  const hasChanged = relevantChanges.some((file) => file.status !== "added");
  const hasAdded = relevantChanges.some((file) => file.status === "added");
  let functionDelta: FunctionDeltaData | undefined;
  if (hasChanged || (hasAdded && deletedFiles.length > 0)) {
    // 基准数据获取与正文读取都可能直接抛异常，按阶段兜底，报告照常输出。
    const pipelineFailure = (detail: string): FunctionDeltaData => ({
      mergeBase,
      baseCoverage: { ok: false, detail, durationMs: 0 },
      rows: [],
      notes: [],
      lineFallbacks: [],
    });
    const [baseOutcome, sourcesOutcome, deletedOutcome] = await Promise.allSettled([
      (dependencies.baseCoverage ?? generateBaseCoverage)({
        repositoryRoot: root,
        mergeBase,
        scratchRoot: path.join(root, ".tmp", "coverage-gate-base"),
      }),
      Promise.all(
        relevantChanges.map(async (file) => {
          try {
            const pair = await (dependencies.sources ?? readSourcePair)(root, mergeBase, file);
            return [file.path, pair] as const;
          } catch (error) {
            // 底层读取错误常常不带路径，这里补上，报告里能直接定位是哪个文件。
            throw new Error(`${file.path}：${errorMessage(error)}`);
          }
        }),
      ),
      readDeletedSources(deletedFiles, root, mergeBase, readBaseText),
    ]);
    if (baseOutcome.status === "rejected") {
      functionDelta = pipelineFailure(`基准覆盖率获取异常：${errorMessage(baseOutcome.reason)}`);
    } else if (sourcesOutcome.status === "rejected") {
      functionDelta = pipelineFailure(`两版正文读取异常：${errorMessage(sourcesOutcome.reason)}`);
    } else if (deletedOutcome.status === "rejected") {
      functionDelta = pipelineFailure(`已删除文件正文读取异常：${errorMessage(deletedOutcome.reason)}`);
    } else {
      try {
        functionDelta = buildFunctionDelta({
          changedFiles: relevantChanges,
          coverage,
          baseCoverage: baseOutcome.value,
          mergeBase,
          sources: new Map(sourcesOutcome.value),
          managedFiles,
          deletedSources: deletedOutcome.value,
        });
      } catch (error) {
        functionDelta = pipelineFailure(`函数结构比对异常：${errorMessage(error)}`);
      }
    }
  }

  const findings = evaluateRules({
    changedFiles: relevantChanges,
    coverage,
    totals,
    managedFiles,
    functionDelta,
    testImports,
    exportUsage,
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
