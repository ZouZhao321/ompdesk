/**
 * 规则二：改动文件的函数增量以分叉点为基准。
 *
 * 只看本次提交的覆盖率，得不出"新加的函数有没有被调用"：文件里原有 15 个函数命中 6 个，
 * 加一个没测的函数后仍是 6 个，数字上毫无变化。所以两侧都要有数字：基准取分叉点的现场
 * 运行结果，本次取当前 lcov；结构差集由两版文件的语法树给出。
 *
 * 通过条件：`本次FNH - 基准FNH >= 新增函数数` 且 `本次FNF >= 基准FNF`。
 *
 * 本票据不处理改名、分成多个与替换式改动（#113）；基准侧路径取改名前的路径，其余按
 * 同名函数逐个比较。
 */

import type { BaseCoverageResult, SourcePair } from "../base-coverage";
import { collectFunctionSurface, diffFunctionSurface } from "../function-names";
import type { ChangedFile } from "../git";
import type { FileCoverage } from "../lcov";
import type { CoverageRule, Finding, RuleInput } from "./index";

export const RULE_ID = "rule-2";

export interface FunctionDeltaRow {
  /** 改动后的路径。 */
  file: string;
  /** 分叉点侧被调用的函数数与函数总数。 */
  baseHit: number;
  baseFound: number;
  /** 本次侧被调用的函数数与函数总数。 */
  headHit: number;
  headFound: number;
  added: readonly string[];
  removed: readonly string[];
  addedReExports: readonly string[];
  removedReExports: readonly string[];
  /** 分叉点版本读不到正文，无法比对结构。 */
  baseSourceMissing: boolean;
  /** 本次版本读不到正文，无法比对结构。 */
  headSourceMissing: boolean;
}

export interface FunctionDeltaData {
  mergeBase: string;
  baseCoverage: BaseCoverageResult;
  rows: readonly FunctionDeltaRow[];
}

export interface FunctionDeltaBuildInput {
  changedFiles: readonly ChangedFile[];
  coverage: ReadonlyMap<string, FileCoverage>;
  baseCoverage: BaseCoverageResult;
  mergeBase: string;
  /** 按改动后的路径索引的两版正文。 */
  sources: ReadonlyMap<string, SourcePair>;
}

const EMPTY_SURFACE = { defined: new Set<string>(), reExported: new Set<string>() };

/**
 * 组装规则二的比较数据。纯函数：正文、两份覆盖率与改动清单都由调用方给出，测试用固定
 * 样本，不读真实仓库。
 */
export function buildFunctionDelta(input: FunctionDeltaBuildInput): FunctionDeltaData {
  const baseCoverage = input.baseCoverage.ok ? input.baseCoverage.coverage : new Map<string, FileCoverage>();

  const rows = input.changedFiles
    // 新增文件走规则一，这里不重复判定。
    .filter((file) => file.status !== "added")
    .map((file): FunctionDeltaRow => {
      const pair = input.sources.get(file.path) ?? { base: null, head: null };
      const basePath = file.previousPath ?? file.path;
      const baseMetrics = baseCoverage.get(basePath);
      const headMetrics = input.coverage.get(file.path);
      const baseSurface = pair.base === null
        ? EMPTY_SURFACE
        : collectFunctionSurface(pair.base, basePath);
      const headSurface = pair.head === null
        ? EMPTY_SURFACE
        : collectFunctionSurface(pair.head, file.path);
      const diff = diffFunctionSurface(baseSurface, headSurface);

      return {
        file: file.path,
        baseHit: baseMetrics?.functionsHit ?? 0,
        baseFound: baseMetrics?.functionsFound ?? 0,
        headHit: headMetrics?.functionsHit ?? 0,
        headFound: headMetrics?.functionsFound ?? 0,
        added: diff.added,
        removed: diff.removed,
        addedReExports: diff.addedReExports,
        removedReExports: diff.removedReExports,
        baseSourceMissing: pair.base === null,
        headSourceMissing: pair.head === null,
      };
    });

  return { mergeBase: input.mergeBase, baseCoverage: input.baseCoverage, rows };
}

/** 「改动前 6/15，改动后 6/16」这一段对照，失败输出现场拼一次。 */
function contrast(row: FunctionDeltaRow): string {
  return `改动前 ${row.baseHit}/${row.baseFound}，改动后 ${row.headHit}/${row.headFound}`;
}

function judgeRow(row: FunctionDeltaRow): Finding[] {
  if (row.headSourceMissing) {
    return [{
      rule: RULE_ID,
      file: row.file,
      numbers: contrast(row),
      reason: "本次版本的文件正文读取失败，函数结构无法比对",
      fix: "确认文件仍在工作区且可读，然后重跑覆盖率门禁",
    }];
  }
  if (row.baseSourceMissing) {
    return [{
      rule: RULE_ID,
      file: row.file,
      numbers: contrast(row),
      reason: "分叉点版本的文件正文读取失败，基准缺失，属流水线问题",
      fix: "确认检出包含分叉点提交（fetch-depth: 0），然后重跑覆盖率门禁",
    }];
  }

  const findings: Finding[] = [];
  const foundDelta = row.headFound - row.baseFound;
  const hitDelta = row.headHit - row.baseHit;

  if (foundDelta < 0) {
    findings.push({
      rule: RULE_ID,
      file: row.file,
      numbers: `${contrast(row)}，函数总数减少 ${-foundDelta}`,
      reason: row.removed.length > 0
        ? `函数总数减少，删除的函数与测试不再对应：${row.removed.join("、")}`
        : "函数总数减少，但两版结构里没有删除的函数名，覆盖率计数与结构不一致",
      fix: row.removed.length > 0
        ? "把删除函数的测试一并移除，或在豁免清单登记本次删除"
        : "确认该文件的加载路径是否变化，计数与结构不一致时按流水线问题排查",
    });
  }

  if (row.added.length > 0 && hitDelta < row.added.length) {
    findings.push({
      rule: RULE_ID,
      file: row.file,
      numbers: `${contrast(row)}，新增 ${row.added.length} 个函数，被调用数增加 ${hitDelta}`,
      reason: `新增函数的被调用数没有同步增加，需要至少 ${row.added.length} 个，实际 ${hitDelta} 个：${row.added.join("、")}`,
      fix: "为新增函数补测试，或把未被使用的函数移出本次改动",
    });
  }

  return findings;
}

export const functionDeltaRule: CoverageRule = {
  id: RULE_ID,
  title: "改动文件的函数增量以分叉点为基准",
  evaluate(input: RuleInput): Finding[] {
    // 只有新增文件时没有可判的改动文件，基准也不必生成，这里直接通过。
    if (input.changedFiles.every((file) => file.status === "added")) return [];

    const data = input.functionDelta;
    if (!data) {
      return [{
        rule: RULE_ID,
        file: "（基准覆盖率）",
        numbers: "改动文件未取得基准数据",
        reason: "规则二没有拿到分叉点的覆盖率与文件正文，无法判定，属流水线问题",
        fix: "确认覆盖率门禁接入了基准数据获取后再重跑",
      }];
    }
    if (!data.baseCoverage.ok) {
      return [{
        rule: RULE_ID,
        file: "（基准覆盖率）",
        numbers: `分叉点 ${data.mergeBase.slice(0, 7)} 的基准运行未产出覆盖率`,
        reason: `基准运行失败，属流水线问题：${data.baseCoverage.detail}`,
        fix: "修复分叉点工作副本或测试命令后重跑；基准缺失不能当作通过",
      }];
    }
    return data.rows.flatMap(judgeRow);
  },
};
