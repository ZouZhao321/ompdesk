/**
 * 基线的格式与生成。
 *
 * 基线记录分叉点之前就存在、且当时就没有生产引用的导出。规则三只拦本次新增，命中基线的
 * 符号不判失败：git 识别不出改名时只能把文件按新增处理，基线让这类重构不至于把存量代码
 * 变成新的失败。
 *
 * 生成基线必须站在分叉点上：拿本次工作区生成会把本次新增的导出一起收进来，规则三就再也
 * 拦不住自己的改动。`bun run coverage:baseline` 按分叉点提交逐个读源码生成，不受工作区
 * 影响。
 */

import { isFrameworkExport } from "./framework-exports";
import { referencesFor, scanSources } from "./exports";
import { isManagedSourceFile, isReferenceSourceFile } from "./git";

/** 基线文件放在仓库根。 */
export const BASELINE_FILE = "coverage-export-baseline.json";

/** 基线条目：一个存量符号由路径、导出名与种类三者共同定位。 */
interface BaselineEntry {
  path: string;
  name: string;
  kind: "type" | "runtime";
}

const READ_CONCURRENCY = 8;

/** 基线条目的键。 */
export function baselineKey(path: string, name: string, kind: BaselineEntry["kind"]): string {
  return `${path}#${name}#${kind}`;
}

/** 解析基线文件。结构不合法时抛出，由调用方把原因写进报告。 */
export function parseBaseline(text: string): BaselineEntry[] {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) throw new Error("基线文件不是对象");
  const symbols = "symbols" in parsed ? parsed.symbols : undefined;
  if (!Array.isArray(symbols)) throw new Error("基线文件缺少 symbols 数组");

  const entries: BaselineEntry[] = [];
  for (const raw of symbols) {
    if (typeof raw !== "object" || raw === null) throw new Error("基线条目不是对象");
    const path = "path" in raw ? raw.path : undefined;
    const name = "name" in raw ? raw.name : undefined;
    const kind = "kind" in raw ? raw.kind : undefined;
    if (typeof path !== "string" || typeof name !== "string") {
      throw new Error("基线条目缺少 path 或 name");
    }
    if (kind !== "type" && kind !== "runtime") {
      throw new Error(`基线条目 ${path}#${name} 的 kind 必须是 type 或 runtime`);
    }
    entries.push({ path, name, kind });
  }
  return entries;
}

/** 序列化基线：条目按路径、名字、种类排序，同一份输入永远产出同一份文件。 */
export function baselineJson(entries: readonly BaselineEntry[]): string {
  const symbols = [...entries].sort(
    (left, right) => left.path.localeCompare(right.path)
      || left.name.localeCompare(right.name)
      || left.kind.localeCompare(right.kind),
  );
  return `${JSON.stringify({ symbols }, null, 2)}\n`;
}

interface BaselineGeneration {
  /** 分叉点版本的存量无引用导出，已排序。 */
  entries: BaselineEntry[];
  /** 参与扫描的文件数，含只作为引用来源的文件。 */
  scannedFiles: number;
}

/**
 * 生成一份基线：受管源文件里没有生产引用的导出。引用来源与规则三一致，测试文件与
 * `test-support/` 不算。
 *
 * `files` 是某个版本的全部仓库文件，读取失败的文件跳过：分叉点上不存在的路径本来
 * 也不该进基线。
 */
export async function generateBaseline(input: {
  files: readonly string[];
  readSource: (filePath: string) => Promise<string | null>;
}): Promise<BaselineGeneration> {
  const managed = input.files.filter(isManagedSourceFile);
  const targets = [...new Set([...managed, ...input.files.filter(isReferenceSourceFile)])].sort();

  const texts = new Map<string, string>();
  let cursor = 0;
  const read = async (): Promise<void> => {
    while (cursor < targets.length) {
      const filePath = targets[cursor];
      cursor += 1;
      const text = await input.readSource(filePath);
      if (text !== null) texts.set(filePath, text);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(READ_CONCURRENCY, targets.length) }, () => read()),
  );

  const { references, exportsByFile } = scanSources(texts);
  const entries: BaselineEntry[] = [];
  for (const filePath of managed) {
    for (const symbol of exportsByFile.get(filePath) ?? []) {
      if (isFrameworkExport(filePath, symbol)) continue;
      if (referencesFor(references, filePath, symbol.name).length > 0) continue;
      entries.push({ path: filePath, name: symbol.name, kind: symbol.kind });
    }
  }

  entries.sort(
    (left, right) => left.path.localeCompare(right.path)
      || left.name.localeCompare(right.name)
      || left.kind.localeCompare(right.kind),
  );
  return { entries, scannedFiles: texts.size };
}
