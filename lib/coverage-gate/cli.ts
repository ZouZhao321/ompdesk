import { readFile } from "node:fs/promises";
import path, { join } from "node:path";
import { generateBaseCoverage, readSourcePair, type BaseCoverageLoader, type SourceReader } from "./base-coverage";
import {
  applyExceptions,
  EXCEPTIONS_FILE,
  localTodayIso,
  resolveExceptions,
  type ExceptionResolution,
} from "./exceptions";
import { BASELINE_FILE } from "./export-baseline";
import { collectExportUsage, exportUsageFailure, type ExportAnalysis } from "./export-usage";
import {
  isManagedSourceFile,
  listChangedFiles,
  listDeletedFiles,
  listManagedSourceFiles,
  listReferenceSourceFiles,
  listTestFiles,
  readFileAtRevision,
  repositoryRoot,
  resolveMergeBase,
  type ChangedFile,
} from "./git";
import { aggregateCoverage, indexByPath, parseLcov, type CoverageTotals } from "./lcov";
import { renderExportReport, renderReport, type ReportTimings } from "./report";
import { COVERAGE_RULES, EXPORT_RULES, evaluateRules } from "./rules";
import { buildFunctionDelta, type FunctionDeltaData } from "./rules/rule-function-delta";
import { collectTestImports } from "./test-imports";
import { LCOV_PATH, type TestSummary } from "./test-command";

/**
 * 退出码分三档，报告与文档用同一组数字：
 *
 * - 0：通过；
 * - 1：有判定未通过，或豁免清单校验失败——代码的问题；
 * - 2：门禁本身没有跑起来——覆盖率产物缺失、git 读不到分叉点、源码读不出来。
 *
 * 2 与 1 分开是为了不让「门禁没运行」看起来像「代码没被测到」，也不会被当成通过。
 */
const PASS_EXIT_CODE = 0;
const FAILURE_EXIT_CODE = 1;
const UNAVAILABLE_EXIT_CODE = 2;

/** git 查询的注入点：命令行用默认实现，测试用固定样本，不读真实仓库状态。 */
interface GitQueries {
  repositoryRoot(cwd: string): Promise<string>;
  mergeBase(cwd: string, baseRef: string): Promise<string>;
  changedFiles(cwd: string, mergeBase: string): Promise<ChangedFile[]>;
  managedSourceFiles(cwd: string): Promise<string[]>;
  /** 测试文件清单；注入的桩没有这一项时被动覆盖检查跳过。 */
  testFiles?(cwd: string): Promise<string[]>;
  /** 分叉点以来被删除的受管源文件；桩没有这一项时按没有删除处理。 */
  deletedFiles?(cwd: string, mergeBase: string): Promise<string[]>;
  /** 生产引用来源（受管源文件 + `scripts/` + `bin/`）；桩没有这一项时退回受管源文件。 */
  referenceSourceFiles?(cwd: string): Promise<string[]>;
}

const GIT_QUERIES: GitQueries = {
  repositoryRoot,
  mergeBase: resolveMergeBase,
  changedFiles: listChangedFiles,
  managedSourceFiles: listManagedSourceFiles,
  testFiles: listTestFiles,
  deletedFiles: listDeletedFiles,
  referenceSourceFiles: listReferenceSourceFiles,
};

interface CoverageGateOptions {
  cwd: string;
  /** lcov 产物路径；省略时取共享定义的默认位置，与测试命令的产物目录一致。 */
  lcovPath?: string;
  /** 合并目标分支，默认 `origin/main`。 */
  baseRef?: string;
  /** 本次带覆盖率的测试运行耗时，命令行入口实测后传入，报告里作为分段耗时展示。 */
  testDurationMs?: number;
  /** 本次测试运行的用例统计；命令行入口从测试输出取，报告里注明跳过数量。 */
  testSummary?: TestSummary;
}

interface CoverageGateDependencies {
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

interface CoverageGateResult {
  /** 0 通过；1 有判定未通过；2 门禁没有跑起来。 */
  exitCode: number;
  report: string;
}

export const DEFAULT_BASE_REF = "origin/main";

/** 没有改动文件时规则输入里的空覆盖率合计。 */
const EMPTY_TOTALS: CoverageTotals = { linesFound: 0, linesHit: 0, functionsFound: 0, functionsHit: 0 };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 门禁没跑起来时的报告；与判定失败分开报，退出码为 2。 */
function unavailable(detail: string): CoverageGateResult {
  return {
    exitCode: UNAVAILABLE_EXIT_CODE,
    report: [
      "覆盖率门禁未能运行",
      `  ${detail}`,
      `  退出码 ${UNAVAILABLE_EXIT_CODE}：门禁本身没有跑起来，不代表代码没有被测试。`,
    ].join("\n"),
  };
}

/** 默认的读取实现：直接读磁盘，测试注入自己的读取函数。 */
const readDiskText = (filePath: string): Promise<string> => readFile(filePath, "utf8");

/** 目标文件不存在：可选文件与工作区里已删除的受管文件都会走到这里。 */
function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** 读仓库根下的一个可选文件：不存在时返回 null，其余读取错误照常抛出。 */
async function readOptionalFile(
  root: string,
  fileName: string,
  read: (filePath: string) => Promise<string>,
): Promise<string | null> {
  try {
    return await read(join(root, fileName));
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

/**
 * 测试文件的导入索引。git 查询的桩没有 `testFiles` 时返回 undefined，被动覆盖检查随之
 * 跳过：空索引会被当成「没有任何测试导入过这个符号」，与桩缺少这项查询的语义相反。
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

interface RepositoryFacts {
  root: string;
  mergeBase: string;
  changedFiles: ChangedFile[];
  managedFiles: string[];
  deletedFiles: string[];
  exceptions: ExceptionResolution;
}

type RepositoryLoad = { ok: true; facts: RepositoryFacts } | { ok: false; detail: string };

/**
 * 两个判定入口共用的仓库事实：仓库根、分叉点、改动清单、受管源文件、删除清单与豁免
 * 清单。任何一步读不出来都返回原因，由调用方以「门禁没跑起来」收尾。
 */
async function loadRepositoryFacts(
  git: GitQueries,
  options: CoverageGateOptions,
  dependencies: CoverageGateDependencies,
  baseRef: string,
  loadExceptions: (root: string) => Promise<ExceptionResolution>,
): Promise<RepositoryLoad> {
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
      ok: false,
      detail:
        `git 数据读取失败：${errorMessage(error)}。` + "分叉点需要完整检出，actions/checkout 需设 fetch-depth: 0。",
    };
  }

  let exceptions: ExceptionResolution;
  try {
    exceptions = await loadExceptions(root);
  } catch (error) {
    return { ok: false, detail: `豁免清单读取失败：${errorMessage(error)}。` };
  }

  return {
    ok: true,
    facts: {
      root,
      mergeBase,
      changedFiles: changedFiles.filter((file) => isManagedSourceFile(file.path)),
      managedFiles,
      deletedFiles,
      exceptions,
    },
  };
}

/** 豁免清单的读取 + 解析；读取失败记成一条整体问题，与格式错误同样参与退出码。 */
async function resolveRepositoryExceptions(
  readExceptions: (root: string) => Promise<string | null>,
  today: string,
  root: string,
): Promise<ExceptionResolution> {
  let text: string | null = null;
  let readError: string | undefined;
  try {
    text = await readExceptions(root);
  } catch (error) {
    readError = errorMessage(error);
  }
  const resolution = resolveExceptions(text, today);
  if (readError !== undefined) resolution.problems.push({ index: 0, message: `读取失败：${readError}` });
  return resolution;
}

/** 退出码：有判定未通过，或豁免清单校验失败。 */
function failureExitCode(blocking: number, exceptionProblems: number): number {
  return blocking > 0 || exceptionProblems > 0 ? FAILURE_EXIT_CODE : PASS_EXIT_CODE;
}

/**
 * 覆盖率判定：读两份覆盖率，跑规则一与规则二，渲染报告。
 *
 * 规则三（新增导出的生产引用）不读覆盖率，单独由 `runExportGate` 在测试之前执行，失败
 * 时省下两次测试运行。产物缺失、git 读不到分叉点或源码读不出来时退出码为 2：门禁本身
 * 没跑起来不等于代码没被测试，但也不能当作通过。
 */
export async function runCoverageGate(
  options: CoverageGateOptions,
  dependencies: CoverageGateDependencies = {},
): Promise<CoverageGateResult> {
  const readText = dependencies.readText ?? readDiskText;
  const readBaseText = dependencies.readBaseText ?? readFileAtRevision;
  const git = dependencies.git ?? GIT_QUERIES;
  const baseRef = options.baseRef ?? DEFAULT_BASE_REF;
  const lcovPath = options.lcovPath ?? LCOV_PATH;
  const today = dependencies.today ?? localTodayIso();
  const readExceptions =
    dependencies.readExceptions ?? ((root: string) => readOptionalFile(root, EXCEPTIONS_FILE, readDiskText));

  // 分析的计时从读产物开始，基准运行的耗时从 `generateBaseCoverage` 的结果里扣出来。
  const analysisStartedAt = Date.now();

  let lcovText: string;
  try {
    lcovText = await readText(lcovPath);
  } catch (error) {
    return unavailable(
      `覆盖率产物缺失：${lcovPath}（${errorMessage(error)}）。` + "先运行 bun run coverage:gate 生成 lcov。",
    );
  }

  const parsed = parseLcov(lcovText);
  const coverage = indexByPath(parsed.files);
  const totals = aggregateCoverage(parsed.files);

  const loaded = await loadRepositoryFacts(git, options, dependencies, baseRef, (root) =>
    resolveRepositoryExceptions(readExceptions, today, root),
  );
  if (!loaded.ok) return unavailable(loaded.detail);
  const { root, mergeBase, changedFiles, managedFiles, deletedFiles, exceptions } = loaded.facts;

  let testImports: ReadonlyMap<string, ReadonlySet<string>> | undefined;
  try {
    testImports = await collectTestImportIndex(git, root, readText);
  } catch (error) {
    return unavailable(`测试文件导入语句读取失败：${errorMessage(error)}。`);
  }

  // 改名、拆分与替换的识别要看两侧函数名：有改动的非新增文件，或有新增文件而又删了文件
  // （拆分与合一的形状）时才取基准，其余情形省一次测试运行。
  const hasChanged = changedFiles.some((file) => file.status !== "added");
  const hasAdded = changedFiles.some((file) => file.status === "added");
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
        changedFiles.map(async (file) => {
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
          changedFiles,
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

  const findings = evaluateRules(
    {
      changedFiles,
      coverage,
      totals,
      managedFiles,
      functionDelta,
      testImports,
    },
    COVERAGE_RULES,
  );
  // 有效豁免只放行登记的那一条规则与那一个文件；已到期条目不放行任何判定。
  const { blocking, exceptions: applied } = applyExceptions(findings, exceptions);

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
    changedFiles,
    coverage,
    totals,
    droppedRecords: parsed.dropped.length,
    duplicateRecords: parsed.duplicates,
    managedFileCount: managedFiles.length,
    missingManagedFiles: managedFiles.filter((file) => !coverage.has(file)),
    functionDelta,
    exceptions: applied,
    timings,
    ...(options.testSummary === undefined ? {} : { testSummary: options.testSummary }),
    findings: blocking,
  });

  return { exitCode: failureExitCode(blocking.length, exceptions.problems.length), report };
}

/**
 * 静态引用检查：规则三。不需要覆盖率产物，因此排在测试之前；失败时后面的测试不再运行。
 *
 * git 读不到分叉点时按「门禁没跑起来」处理，退出码 2；源码或基线读不出来则交给规则三
 * 报成流水线问题，退出码 1——那时判定数据不全，需要人工看报告，而不是当成通过。
 */
export async function runExportGate(
  options: Omit<CoverageGateOptions, "lcovPath" | "testDurationMs" | "testSummary">,
  dependencies: CoverageGateDependencies = {},
): Promise<CoverageGateResult> {
  const startedAt = Date.now();
  const readText = dependencies.readText ?? readDiskText;
  const readBaseText = dependencies.readBaseText ?? readFileAtRevision;
  const readBaseline =
    dependencies.readBaseline ?? ((root: string) => readOptionalFile(root, BASELINE_FILE, readDiskText));
  const git = dependencies.git ?? GIT_QUERIES;
  const baseRef = options.baseRef ?? DEFAULT_BASE_REF;
  const today = dependencies.today ?? localTodayIso();
  const readExceptions =
    dependencies.readExceptions ?? ((root: string) => readOptionalFile(root, EXCEPTIONS_FILE, readDiskText));

  const loaded = await loadRepositoryFacts(git, options, dependencies, baseRef, (root) =>
    resolveRepositoryExceptions(readExceptions, today, root),
  );
  if (!loaded.ok) return unavailable(loaded.detail);
  const { root, mergeBase, changedFiles, managedFiles, exceptions } = loaded.facts;

  const referenceFiles = git.referenceSourceFiles ? await git.referenceSourceFiles(root) : managedFiles;

  let baselineText: string | null;
  let exportUsage: ExportAnalysis;
  try {
    baselineText = await readBaseline(root);
    exportUsage = await collectExportUsage({
      changedFiles,
      referenceFiles,
      readers: {
        readWorkspace: (filePath) => readText(join(root, filePath)),
        readAtMergeBase: (filePath) => readBaseText(root, mergeBase, filePath),
      },
      baselineText,
    });
  } catch (error) {
    // 分析整体失败也走规则：规则三把它报成流水线问题，报告里带上原因与定位信息。
    exportUsage = exportUsageFailure(`导出引用分析失败：${errorMessage(error)}`);
  }

  const findings = evaluateRules(
    {
      changedFiles,
      coverage: new Map(),
      totals: EMPTY_TOTALS,
      managedFiles: referenceFiles,
      exportUsage,
    },
    EXPORT_RULES,
  );
  const { blocking, exceptions: applied } = applyExceptions(findings, exceptions);

  const report = renderExportReport({
    baseRef,
    mergeBase,
    changedFiles,
    scannedFiles: exportUsage.scannedFiles,
    baselineCount: exportUsage.baseline.size,
    findings: blocking,
    exceptions: applied,
    analysisMs: Date.now() - startedAt,
  });

  return { exitCode: failureExitCode(blocking.length, exceptions.problems.length), report };
}
