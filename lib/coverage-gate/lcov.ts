/**
 * lcov 文本解析。
 *
 * Bun 的 lcov 只给汇总行（LF/LH、FNF/FNH），没有 FN/FNDA，因此函数只能给出数量，
 * 不能指认具体哪个函数未被调用。解析器只保留仓库内的记录：
 *
 * - 路径先统一成正斜杠，再折叠 `.` 与 `..` 段；
 * - `..` 开头、绝对路径、折叠后逃出仓库根的记录整条丢弃；
 * - 同一路径带 `?mtime=` 查询串重复出现时，按首次出现的记录计。
 *
 * 判定因此与平台无关：Windows 上产出的反斜杠路径与 Linux 上产出的正斜杠路径归一成同一
 * 个键，同一份提交在本地与持续集成得到相同结论。持续集成（Linux）是权威结论，Windows
 * 专属分支走豁免清单。
 */

const SOURCE_LINE_RE = /^(LF|LH|FNF|FNH):(.*)$/;

/** 单文件指标，字段名与 lcov 的计数字段一一对应。 */
export interface FileCoverage {
  /** 仓库内相对路径，固定用 `/` 分隔。 */
  path: string;
  linesFound: number;
  linesHit: number;
  functionsFound: number;
  functionsHit: number;
}

/** 仓库内合计指标，按加权求和得到，不做逐文件百分比的算术平均。 */
export interface CoverageTotals {
  linesFound: number;
  linesHit: number;
  functionsFound: number;
  functionsHit: number;
}

interface LcovParseResult {
  files: FileCoverage[];
  /** 因仓库外、绝对路径或越界而丢弃的原始路径。 */
  dropped: string[];
  /** 同一路径重复出现而忽略的记录数。 */
  duplicates: number;
}

interface PendingRecord {
  path: string;
  linesFound?: number;
  linesHit?: number;
  functionsFound?: number;
  functionsHit?: number;
  executableLines: number;
  hitLines: number;
}

/**
 * 折叠路径段。以 `..` 开头、带盘符或以 `/` 开头的绝对路径由调用方先挡掉；
 * 这里的 `..` 只处理出现在中间段的写法，逃出根目录时返回 null。
 */
function foldPath(normalized: string): string | null {
  const segments: string[] = [];
  for (const segment of normalized.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length > 0 ? segments.join("/") : null;
}

/**
 * 仓库内路径判定。绝对路径与越界路径返回 null：它们不属于本次改动的仓库，
 * 进了分母会让本机环境改变数字。
 */
function toRepositoryPath(raw: string): string | null {
  // `?mtime=` 一类查询串不是路径的一部分；Windows 上 SF 记录用反斜杠。
  const normalized = raw.split("?", 1)[0].replace(/\\/g, "/").trim();
  if (!normalized) return null;
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return null;
  if (normalized === ".." || normalized.startsWith("../")) return null;
  return foldPath(normalized);
}

function count(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : undefined;
}

function finishRecord(record: PendingRecord): FileCoverage {
  const linesFound = record.linesFound ?? record.executableLines;
  const linesHit = Math.min(record.linesHit ?? record.hitLines, linesFound);
  const functionsFound = record.functionsFound ?? 0;
  const functionsHit = Math.min(record.functionsHit ?? 0, functionsFound);
  return {
    path: record.path,
    linesFound,
    linesHit,
    functionsFound,
    functionsHit,
  };
}

/**
 * 解析 lcov 文本。缺字段按能推导的部分补齐：LF/LH 缺失时用 DA 行数统计，
 * FNF/FNH 缺失时记 0；命中数不会超过总数。
 */
export function parseLcov(text: string): LcovParseResult {
  const files: FileCoverage[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let current: PendingRecord | null = null;

  const commit = (record: PendingRecord): void => {
    if (seen.has(record.path)) {
      duplicates += 1;
      return;
    }
    seen.add(record.path);
    files.push(finishRecord(record));
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.startsWith("SF:")) {
      if (current) commit(current);
      const rawPath = line.slice(3);
      const path = toRepositoryPath(rawPath);
      if (path === null) {
        dropped.push(rawPath);
        current = null;
      } else {
        current = { path, executableLines: 0, hitLines: 0 };
      }
      continue;
    }

    if (line === "end_of_record") {
      if (current) commit(current);
      current = null;
      continue;
    }

    if (!current) continue;

    if (line.startsWith("DA:")) {
      const [, hitsText] = line.slice(3).split(",");
      const hits = count(hitsText);
      if (hits === undefined) continue;
      current.executableLines += 1;
      if (hits > 0) current.hitLines += 1;
      continue;
    }

    const summary = SOURCE_LINE_RE.exec(line);
    if (!summary) continue;
    const value = count(summary[2]);
    if (value === undefined) continue;
    if (summary[1] === "LF") current.linesFound = value;
    else if (summary[1] === "LH") current.linesHit = value;
    else if (summary[1] === "FNF") current.functionsFound = value;
    else current.functionsHit = value;
  }
  if (current) commit(current);
  return { files, dropped, duplicates };
}

/** 按路径建索引，后续规则按改动清单逐个取指标。 */
export function indexByPath(files: readonly FileCoverage[]): Map<string, FileCoverage> {
  const index = new Map<string, FileCoverage>();
  for (const file of files) index.set(file.path, file);
  return index;
}

/** 仓库内加权合计：ΣLH / ΣLF 与 ΣFNH / ΣFNF，不用逐文件百分比的算术平均。 */
export function aggregateCoverage(files: readonly FileCoverage[]): CoverageTotals {
  let linesFound = 0;
  let linesHit = 0;
  let functionsFound = 0;
  let functionsHit = 0;
  for (const file of files) {
    linesFound += file.linesFound;
    linesHit += file.linesHit;
    functionsFound += file.functionsFound;
    functionsHit += file.functionsHit;
  }
  return { linesFound, linesHit, functionsFound, functionsHit };
}
