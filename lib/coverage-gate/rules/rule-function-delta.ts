/**
 * 规则二：改动文件的函数增量以分叉点为基准。
 *
 * 只看本次提交的覆盖率，得不出"新加的函数有没有被调用"：文件里原有 15 个函数命中 6 个，
 * 加一个没测的函数后仍是 6 个，数字上毫无变化。所以两侧都要有数字：基准取分叉点的现场
 * 运行结果，本次取当前 lcov；结构差集由两版文件的语法树给出。
 *
 * 通过条件：`本次FNH - 基准FNH >= 新增函数数` 且 `本次FNF >= 基准FNF`。两条都无条件比较：
 * 没有新增函数时，被调用数同样不得减少。
 *
 * 常规重构会让这套计数读出错误结论，失真处理见 `distortion.ts`：
 *
 * - 改名按改名前的路径取基准；git 没识别出改名时按新增文件走规则一；
 * - 一个文件分成多个或合为一个时用函数名集合逐个对应，对不上的情形豁免本规则并退回行
 *   覆盖增量；
 * - 删除旧函数后新增函数、净增量为零时判为疑似替换，转人工豁免。
 *
 * 另外，新增的对外函数名必须出现在某个测试文件的导入语句里，内部辅助函数不受这条约束。
 */

import type { BaseCoverageResult, SourcePair } from "../base-coverage";
import { collectFunctionSurface, collectNamedFunctionExports, diffFunctionSurface } from "../function-names";
import { isManagedSourceFile, type ChangedFile } from "../git";
import type { FileCoverage } from "../lcov";
import { isImportedByTest } from "../test-imports";
import { analyzeDistortion, type DistortionNote, type LineFallback } from "./distortion";
import type { CoverageRule, Finding, RuleInput } from "./index";

const RULE_ID = "rule-2";

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
  /** 新增函数里对外暴露的导出名，用于被动覆盖的静态检查。 */
  addedExported: readonly string[];
  /** 分叉点版本读不到正文，无法比对结构。 */
  baseSourceMissing: boolean;
  /** 本次版本读不到正文，无法比对结构。 */
  headSourceMissing: boolean;
  /** 结构改造后本规则免征这一行；有值时不做函数增量判定。 */
  exemptReason?: string;
}

export interface FunctionDeltaData {
  mergeBase: string;
  baseCoverage: BaseCoverageResult;
  rows: readonly FunctionDeltaRow[];
  /** 失真处理的说明，报告里单独列出。 */
  notes: readonly DistortionNote[];
  /** 函数名集合对应不完整、退回行覆盖增量的组。 */
  lineFallbacks: readonly LineFallback[];
}

interface FunctionDeltaBuildInput {
  changedFiles: readonly ChangedFile[];
  coverage: ReadonlyMap<string, FileCoverage>;
  baseCoverage: BaseCoverageResult;
  mergeBase: string;
  /** 按本次路径索引的两版正文。 */
  sources: ReadonlyMap<string, SourcePair>;
  /** 本次受管源文件清单，用来认出分叉点有、本次已删除的路径。 */
  managedFiles?: readonly string[];
  /** 已删除路径在分叉点的正文；用于改名与拆分的函数名对应。 */
  deletedSources?: ReadonlyMap<string, string>;
}

const EMPTY_SURFACE = { defined: new Set<string>(), reExported: new Set<string>() };

/**
 * 组装规则二的比较数据。纯函数：正文、两份覆盖率与改动清单都由调用方给出，测试用固定
 * 样本，不读真实仓库。
 */
export function buildFunctionDelta(input: FunctionDeltaBuildInput): FunctionDeltaData {
  const baseCoverage = input.baseCoverage.ok ? input.baseCoverage.coverage : new Map<string, FileCoverage>();
  const managed = new Set(input.managedFiles ?? []);
  const renamedPrevious = new Set(
    input.changedFiles
      .map((file) => file.previousPath)
      .filter((previousPath): previousPath is string => previousPath !== undefined),
  );

  const rows: FunctionDeltaRow[] = [];
  const addedFiles: { path: string; names: ReadonlySet<string> }[] = [];
  const persistent: {
    path: string;
    basePath: string;
    baseNames: ReadonlySet<string>;
    headNames: ReadonlySet<string>;
  }[] = [];
  const renames: { path: string; previousPath: string; baseCovered: boolean }[] = [];

  for (const file of input.changedFiles) {
    const pair = input.sources.get(file.path) ?? { base: null, head: null };
    const basePath = file.previousPath ?? file.path;
    const headSurface = pair.head === null ? EMPTY_SURFACE : collectFunctionSurface(pair.head, file.path);

    if (file.status === "renamed" && file.previousPath !== undefined) {
      renames.push({
        path: file.path,
        previousPath: file.previousPath,
        baseCovered: baseCoverage.has(file.previousPath),
      });
    }

    if (file.status === "added") {
      // 新增文件走规则一，这里只留函数名供结构改造的对应使用。
      addedFiles.push({ path: file.path, names: headSurface.defined });
      continue;
    }

    const baseSurface = pair.base === null ? EMPTY_SURFACE : collectFunctionSurface(pair.base, basePath);
    const diff = diffFunctionSurface(baseSurface, headSurface);
    const baseMetrics = baseCoverage.get(basePath);
    const headMetrics = input.coverage.get(file.path);
    const exportedNames = pair.head === null ? {} : collectNamedFunctionExports(pair.head, file.path);
    const addedExported = Object.keys(exportedNames)
      .filter((exported) => diff.added.includes(exportedNames[exported]))
      .sort();

    rows.push({
      file: file.path,
      baseHit: baseMetrics?.functionsHit ?? 0,
      baseFound: baseMetrics?.functionsFound ?? 0,
      headHit: headMetrics?.functionsHit ?? 0,
      headFound: headMetrics?.functionsFound ?? 0,
      added: diff.added,
      removed: diff.removed,
      addedReExports: diff.addedReExports,
      removedReExports: diff.removedReExports,
      addedExported,
      baseSourceMissing: pair.base === null,
      headSourceMissing: pair.head === null,
    });

    if (diff.removed.length > 0) {
      persistent.push({
        path: file.path,
        basePath,
        baseNames: baseSurface.defined,
        headNames: headSurface.defined,
      });
    }
  }

  const deleted =
    input.managedFiles === undefined
      ? []
      : [...baseCoverage.keys()]
          .filter((path) => !managed.has(path) && !renamedPrevious.has(path) && isManagedSourceFile(path))
          .flatMap((path) => {
            const text = input.deletedSources?.get(path);
            if (text === undefined) return [];
            return [{ path, names: collectFunctionSurface(text, path).defined }];
          });

  // 两侧都没有覆盖率记录时「净增量为零」平凡成立，那不是替换失真，而是这个文件从未被加载，
  // 不能借此豁免本规则，否则未测文件里的替换会静默通过。
  const replacements = rows
    .filter(
      (row) => row.added.length > 0 && row.removed.length > 0 && row.baseFound > 0 && row.headFound === row.baseFound,
    )
    .map((row) => ({ path: row.file, added: row.added, removed: row.removed }));

  const distortion = analyzeDistortion({
    renames,
    deleted,
    added: addedFiles,
    persistent,
    replacements,
    baseCoverage,
    coverage: input.coverage,
  });

  return {
    mergeBase: input.mergeBase,
    baseCoverage: input.baseCoverage,
    rows: rows.map((row) => {
      const reason = distortion.exemptions.get(row.file);
      return reason === undefined ? row : { ...row, exemptReason: reason };
    }),
    notes: distortion.notes,
    lineFallbacks: distortion.lineFallbacks,
  };
}

/** 「改动前 6/15，改动后 6/16」这一段对照，失败输出现场拼一次。 */
function contrast(row: FunctionDeltaRow): string {
  return `改动前 ${row.baseHit}/${row.baseFound}，改动后 ${row.headHit}/${row.headFound}`;
}

/** 新增的对外函数名必须被某个测试文件导入；内部辅助函数不在此列。 */
function passiveCoverageFindings(row: FunctionDeltaRow, testImports: RuleInput["testImports"]): Finding[] {
  if (row.addedExported.length === 0 || testImports === undefined) return [];

  const missing = row.addedExported.filter((name) => !isImportedByTest(testImports, row.file, name));
  if (missing.length === 0) return [];

  const imported = row.addedExported.length - missing.length;
  return [
    {
      rule: RULE_ID,
      file: row.file,
      numbers: `新增对外函数 ${row.addedExported.length} 个，测试导入 ${imported} 个`,
      reason: `新增的对外函数名没有出现在任何测试文件的导入语句里：${missing.join("、")}`,
      fix: "在测试文件里 import 这些符号并调用，或把它们改为模块内部函数",
    },
  ];
}

function judgeRow(row: FunctionDeltaRow, testImports: RuleInput["testImports"]): Finding[] {
  if (row.headSourceMissing) {
    return [
      {
        rule: RULE_ID,
        file: row.file,
        numbers: contrast(row),
        reason: "本次版本的文件正文读取失败，函数结构无法比对",
        fix: "确认文件仍在工作区且可读，然后重跑覆盖率门禁",
      },
    ];
  }
  if (row.baseSourceMissing) {
    return [
      {
        rule: RULE_ID,
        file: row.file,
        numbers: contrast(row),
        reason: "分叉点版本的文件正文读取失败，基准缺失，属流水线问题",
        fix: "确认检出包含分叉点提交（fetch-depth: 0），然后重跑覆盖率门禁",
      },
    ];
  }
  // 结构改造后这一行的函数增量不代表新增代码是否被测，转由失真处理的说明承担。
  if (row.exemptReason !== undefined) return [];

  const findings: Finding[] = [];
  const foundDelta = row.headFound - row.baseFound;
  const hitDelta = row.headHit - row.baseHit;

  if (foundDelta < 0) {
    findings.push({
      rule: RULE_ID,
      file: row.file,
      numbers: `${contrast(row)}，函数总数减少 ${-foundDelta}`,
      reason:
        row.removed.length > 0
          ? `函数总数减少，删除的函数与测试不再对应：${row.removed.join("、")}`
          : "函数总数减少，但两版结构里没有删除的函数名，覆盖率计数与结构不一致",
      fix:
        row.removed.length > 0
          ? "把删除函数的测试一并移除，或在豁免清单登记本次删除"
          : "确认该文件的加载路径是否变化，计数与结构不一致时按流水线问题排查",
    });
  }

  if (hitDelta < row.added.length) {
    findings.push({
      rule: RULE_ID,
      file: row.file,
      numbers: `${contrast(row)}，新增 ${row.added.length} 个函数，被调用数增加 ${hitDelta}`,
      reason:
        row.added.length > 0
          ? `新增函数的被调用数没有同步增加，需要至少 ${row.added.length} 个，实际 ${hitDelta} 个：${row.added.join("、")}`
          : "本次改动没有新增函数，但函数被调用数相对分叉点减少，减少的调用没有被补回",
      fix:
        row.added.length > 0
          ? "为新增函数补测试，或把未被使用的函数移出本次改动"
          : "确认改动是否让原有函数不再被测试调用，补回相应测试",
    });
  }

  findings.push(...passiveCoverageFindings(row, testImports));
  return findings;
}

/** 函数名集合对应不完整时的退路：按行覆盖增量判定。 */
function judgeLineFallback(fallback: LineFallback): Finding | null {
  const hitDelta = fallback.headLinesHit - fallback.baseLinesHit;
  const foundDelta = fallback.headLinesFound - fallback.baseLinesFound;
  if (hitDelta >= foundDelta) return null;

  return {
    rule: RULE_ID,
    file: fallback.label,
    numbers: `行 改动前 ${fallback.baseLinesHit}/${fallback.baseLinesFound}，改动后 ${fallback.headLinesHit}/${fallback.headLinesFound}`,
    reason: "函数名集合对应不完整，规则二豁免，退回行覆盖增量判定：新增的行没有被测试覆盖",
    fix: "为拆分或合并后新增的行补测试，或在豁免清单登记替代验证方式",
  };
}

export const functionDeltaRule: CoverageRule = {
  id: RULE_ID,
  title: "改动文件的函数增量以分叉点为基准",
  evaluate(input: RuleInput): Finding[] {
    if (input.changedFiles.length === 0) return [];

    const data = input.functionDelta;
    if (!data) {
      // 只有新增文件时函数增量无从比较，规则一已经覆盖它们。
      if (input.changedFiles.every((file) => file.status === "added")) return [];
      return [
        {
          rule: RULE_ID,
          file: "（基准覆盖率）",
          numbers: "改动文件未取得基准数据",
          reason: "规则二没有拿到分叉点的覆盖率与文件正文，无法判定，属流水线问题",
          fix: "确认覆盖率门禁接入了基准数据获取后再重跑",
        },
      ];
    }
    if (!data.baseCoverage.ok) {
      return [
        {
          rule: RULE_ID,
          file: "（基准覆盖率）",
          numbers: `分叉点 ${data.mergeBase.slice(0, 7)} 的基准运行未产出覆盖率`,
          reason: `基准运行失败，属流水线问题：${data.baseCoverage.detail}`,
          fix: "修复分叉点工作副本或测试命令后重跑；基准缺失不能当作通过",
        },
      ];
    }

    const findings: Finding[] = [];
    for (const fallback of data.lineFallbacks) {
      const finding = judgeLineFallback(fallback);
      if (finding) findings.push(finding);
    }
    for (const row of data.rows) findings.push(...judgeRow(row, input.testImports));
    return findings;
  },
};
