import { readFile } from "node:fs/promises";
import path, { join } from "node:path";
import {
  generateBaseCoverage,
  readSourcePair,
  type BaseCoverageLoader,
  type SourceReader,
} from "./base-coverage";
import {
  applyExceptions,
  EXCEPTIONS_FILE,
  localTodayIso,
  resolveExceptions,
} from "./exceptions";
import { BASELINE_FILE, collectExportUsage, type ExportAnalysis } from "./exports";
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
import { renderReport, type ReportTimings } from "./report";
import { evaluateRules } from "./rules";
import { buildFunctionDelta, type FunctionDeltaData } from "./rules/rule-function-delta";
import { collectTestImports } from "./test-imports";
import { LCOV_PATH } from "./test-command";

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
  /** lcov 产物路径；省略时取共享定义的默认位置，与测试命令的产物目录一致。 */
  lcovPath?: string;
  /** 合并目标分支，默认 `origin/main`。 */
  baseRef?: string;
  /** 本次带覆盖率的测试运行耗时，命令行入口实测后传入，报告里作为分段耗时展示。 */
  testDurationMs?: number;
}

export interface CoverageGateDependencies {
  readText?: (filePath: string) => Promise<string>;
  /** 读取分叉点版本的文件；文件在该版本不存在时返回 null。 */
  readBaseText?: (root: string, revision: string, filePath: string) => Promise<string | null>;
  /** 读取基线文件；不存在时返回 null，解析交给规则。 */
  readBaseline?: (root: string) => Promise<string | null>;
  /** 读取豁免清单；文件不存在时返回 null。 */
  readExceptions?: (root: string) => Promise<string | null>;
  /** 豁免复核日期 `YYYY-MM-DD`，默认取运行当天；测试注入固定值。 */
  today?: string;
  git?: GitQueries;
  /** 分叉点基准覆盖率的获取；命令行默认现场生成，测试注入固定样本。 */
  baseCoverage?: BaseCoverageLoader;
  /** 改动文件两版正文的读取；命令行默认走 git 与工作区，测试注入固定样本。 */
  sources?: SourceReader;
}

export interface CoverageGateResult {
  /** 有判定结果或豁免清单校验失败时非零，用来让合并检查变红；产物或 git 数据不可用时保持 0。 */
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
 * 测试文件的导入索引。git 查询的桩没有 `testFiles` 时返回空索引，被动覆盖检查随之跳过。
 */
async function collectTestImportIndex(
  git: GitQueries,
  root: string,
  readText: (filePath: string) => Promise<string>,
): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  if (!git.testFiles) return new Map();

  const testFiles = await git.testFiles(root);
  const sources = new Map<string, string>();
  await Promise.all(
    testFiles.map(async (filePath) => {
      sources.set(filePath, await readText(join(root, filePath)));
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

async function readExceptionsFile(root: string): Promise<string | null> {
  try {
    return await readFile(join(root, EXCEPTIONS_FILE), "utf8");
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

/**
 * 编排一次门禁运行：读 lcov、取分叉点与改动清单、现场生成基准覆盖率、聚合、判定、
 * 渲染报告。
 *
 * 产物缺失、git 读不到分叉点或导出分析读不出源码时把原因写进报告而不是抛出，退出码
 * 保持 0：门禁本身没跑起来不等于代码没被测试。规则有判定结果或豁免清单校验失败时退出
 * 码为 1，检查随之变红。基准运行失败不在此列，它由规则二报成流水线问题并参与退出码。
 */
export async function runCoverageGate(
  options: CoverageGateOptions,
  dependencies: CoverageGateDependencies = {},
): Promise<CoverageGateResult> {
  const readText = dependencies.readText ?? ((filePath: string) => readFile(filePath, "utf8"));
  const readBaseText = dependencies.readBaseText ?? readFileAtRevision;
  const readBaseline = dependencies.readBaseline ?? readBaselineFile;
  const readExceptions = dependencies.readExceptions ?? readExceptionsFile;
  const git = dependencies.git ?? GIT_QUERIES;
  const baseRef = options.baseRef ?? DEFAULT_BASE_REF;
  const lcovPath = options.lcovPath ?? LCOV_PATH;
  // 分析的计时从读产物开始，基准运行的耗时从 `generateBaseCoverage` 的结果里扣出来。
  const analysisStartedAt = Date.now();

  let lcovText: string;
  try {
    lcovText = await readText(lcovPath);
  } catch (error) {
    return {
      exitCode: 0,
      report: renderUnavailable(
        `覆盖率产物缺失：${lcovPath}（${errorMessage(error)}）。`
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
        `git 数据读取失败：${errorMessage(error)}。`
          + "分叉点需要完整检出，actions/checkout 需设 fetch-depth: 0。",
      ),
    };
  }

  const relevantChanges = changedFiles.filter((file) => isManagedSourceFile(file.path));

  let exceptionsText: string | null = null;
  let exceptionReadError: string | undefined;
  try {
    exceptionsText = await readExceptions(root);
  } catch (error) {
    exceptionReadError = errorMessage(error);
  }
  const exceptionResolution = resolveExceptions(
    exceptionsText,
    dependencies.today ?? localTodayIso(),
  );
  if (exceptionReadError !== undefined) {
    exceptionResolution.problems.push({
      index: 0,
      message: `读取失败：${exceptionReadError}`,
    });
  }

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
    return {
      exitCode: 0,
      report: renderUnavailable(`导出引用分析失败：${errorMessage(error)}。`),
    };
  }

  let testImports: ReadonlyMap<string, ReadonlySet<string>>;
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
    const baseCoverage = await (dependencies.baseCoverage ?? generateBaseCoverage)({
      repositoryRoot: root,
      mergeBase,
      scratchRoot: path.join(root, ".tmp", "coverage-gate-base"),
    });
    const [pairs, deletedSources] = await Promise.all([
      Promise.all(
        relevantChanges.map(async (file) => {
          const pair = await (dependencies.sources ?? readSourcePair)(root, mergeBase, file);
          return [file.path, pair] as const;
        }),
      ),
      readDeletedSources(deletedFiles, root, mergeBase, readBaseText),
    ]);
    functionDelta = buildFunctionDelta({
      changedFiles: relevantChanges,
      coverage,
      baseCoverage,
      mergeBase,
      sources: new Map(pairs),
      managedFiles,
      deletedSources,
    });
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
  // 有效豁免只放行登记的那一条规则与那一个文件；已到期条目不放行任何判定。
  const { blocking, exceptions } = applyExceptions(findings, exceptionResolution);

  const baseMs = functionDelta?.baseCoverage.durationMs ?? 0;
  const timings: ReportTimings = {
    ...(options.testDurationMs === undefined ? {} : { testMs: options.testDurationMs }),
    baseMs,
    baseSkipped: functionDelta === undefined,
    analysisMs: Math.max(0, Date.now() - analysisStartedAt - baseMs),
  };

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
    exceptions,
    timings,
    findings: blocking,
  });

  const exitCode = blocking.length > 0 || exceptions.problems.length > 0 ? 1 : 0;
  return { exitCode, report };
}
