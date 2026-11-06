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

/**
 * 采集一次判定所需的全部数据。改动的未跟踪文件不在 `git ls-files` 里，一并扫描：
 * 本地运行与合并检查看到同一批文件。
 */
export async function collectExportUsage(
  options: CollectExportUsageOptions,
): Promise<ExportAnalysis> {
  const paths = new Set(options.referenceFiles);
  for (const change of options.changedFiles) paths.add(change.path);

  const texts = await Promise.all([...paths].sort().map(async (filePath) => {
    const text = await options.readers.readWorkspace(filePath);
    return [filePath, text] as const;
  }));
  const { references, exportsByFile } = scanSources(new Map(texts));

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
    const baseText = change.status === "added" ? null : await options.readers.readAtMergeBase(basePath);
    const baseKeys = new Set((baseText === null ? [] : extractExports(basePath, baseText)).map(
      (symbol) => `${symbol.name}\u0000${symbol.kind}`,
    ));
    for (const symbol of headExports) {
      if (!baseKeys.has(`${symbol.name}\u0000${symbol.kind}`)) added.push({ file: change.path, symbol });
    }
  }

  return {
    added,
    references,
    baseline,
    scannedFiles: paths.size,
    ...(baselineError === undefined ? {} : { baselineError }),
  };
}
