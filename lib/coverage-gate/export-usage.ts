/**
 * 一次导出引用判定的数据采集：工作区源码的引用索引、改动文件两侧的导出对比、基线里的
 * 存量条目。
 *
 * 读文件通过注入的读取函数进行，测试传固定样本；本模块不碰 git、不碰磁盘。
 */

import type { ChangedFile } from "./git";
import { baselineKey, parseBaseline } from "./export-baseline";
import { extractExports, scanSources, type ExportedSymbol, type ReferenceIndex } from "./exports";

/** 新增导出：相对分叉点版本新出现的符号。 */
interface AddedExport {
  file: string;
  symbol: ExportedSymbol;
}

export interface ExportAnalysis {
  added: readonly AddedExport[];
  references: ReferenceIndex;
  /** 基线里的存量条目，键由 `baselineKey` 生成。 */
  baseline: ReadonlySet<string>;
  /** 参与引用统计的生产源文件数。 */
  scannedFiles: number;
  /** 基线文件存在但无法解析时的说明；有值时规则把它报成失败。 */
  baselineError?: string;
  /** 整次分析失败的原因；有值时规则按流水线问题报一条，不再逐符号判定。 */
  analysisError?: string;
  /** 单个文件读取失败的文件与原因；有值时判定数据不全，规则把它报成失败。 */
  readFailures: readonly string[];
}

/** 源码读取的注入点：测试传固定样本，生产读工作区与分叉点版本。 */
interface SourceReaders {
  readWorkspace(path: string): Promise<string>;
  readAtMergeBase(path: string): Promise<string | null>;
}

interface CollectExportUsageOptions {
  changedFiles: readonly ChangedFile[];
  /** 作为生产引用来源的文件：受管源文件与 `scripts/`、`bin/`，不含测试与 `test-support/`。 */
  referenceFiles: readonly string[];
  readers: SourceReaders;
  /** 基线文件内容；文件不存在时传 null。 */
  baselineText: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 目标文件不存在：工作区里已删除的受管文件会走到这里，不算读取失败。 */
function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/**
 * 采集一次判定所需的全部数据。改动的未跟踪文件不在 `git ls-files` 里，一并扫描：
 * 本地运行与合并检查看到同一批文件。
 *
 * 单个文件读不出来不放弃整次分析：工作区里已删除的受管文件按不存在处理，其余读取
 * 失败记进 `readFailures`，由规则报成流水线问题，别的规则照常判定。
 */
export async function collectExportUsage(options: CollectExportUsageOptions): Promise<ExportAnalysis> {
  const paths = new Set(options.referenceFiles);
  const changedPaths = new Set<string>();
  for (const change of options.changedFiles) {
    paths.add(change.path);
    changedPaths.add(change.path);
  }

  const texts = new Map<string, string>();
  const readFailures: string[] = [];
  await Promise.all(
    [...paths].sort().map(async (filePath) => {
      try {
        texts.set(filePath, await options.readers.readWorkspace(filePath));
      } catch (error) {
        // 工作区里删掉的文件按不存在处理；改动清单里的文件本该在，读不到就是数据不全，
        // 不能静默跳过，否则它的新增导出会从判定里消失。
        if (!isMissingFile(error) || changedPaths.has(filePath)) {
          readFailures.push(`${filePath}：${errorMessage(error)}`);
        }
      }
    }),
  );
  const { references, exportsByFile } = scanSources(texts);

  const baseline = new Set<string>();
  let baselineError: string | undefined;
  if (options.baselineText !== null) {
    try {
      for (const entry of parseBaseline(options.baselineText)) {
        baseline.add(baselineKey(entry.path, entry.name, entry.kind));
      }
    } catch (error) {
      baselineError = error instanceof Error ? error.message : String(error);
    }
  }

  const added: AddedExport[] = [];
  for (const change of options.changedFiles) {
    const headExports = exportsByFile.get(change.path) ?? [];
    if (headExports.length === 0) continue;

    const basePath = change.previousPath ?? change.path;
    let baseText: string | null;
    try {
      baseText = change.status === "added" ? null : await options.readers.readAtMergeBase(basePath);
    } catch (error) {
      readFailures.push(`分叉点 ${basePath}：${errorMessage(error)}`);
      continue;
    }
    const baseKeys = new Set(
      (baseText === null ? [] : extractExports(basePath, baseText)).map(
        (symbol) => `${symbol.name}\u0000${symbol.kind}`,
      ),
    );
    for (const symbol of headExports) {
      if (baseKeys.has(`${symbol.name}\u0000${symbol.kind}`)) continue;
      added.push({ file: change.path, symbol });
      // 基线只豁免分叉点之前就存在的符号。本次新增的导出即使出现在基线里也不放行，
      // 否则改一次基线就能让规则三自我豁免。
      baseline.delete(baselineKey(change.path, symbol.name, symbol.kind));
    }
  }

  readFailures.sort();

  return {
    added,
    references,
    baseline,
    scannedFiles: texts.size,
    readFailures,
    ...(baselineError === undefined ? {} : { baselineError }),
  };
}

/** 导出分析整体没跑起来时的空结果：规则据 `analysisError` 报成流水线问题。 */
export function exportUsageFailure(detail: string): ExportAnalysis {
  return {
    added: [],
    references: new Map(),
    baseline: new Set(),
    scannedFiles: 0,
    readFailures: [],
    analysisError: detail,
  };
}
