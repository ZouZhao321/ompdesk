import type { ExportAnalysis } from "../export-usage";
import type { ChangedFile } from "../git";
import type { CoverageTotals, FileCoverage } from "../lcov";
import { functionDeltaRule, type FunctionDeltaData } from "./rule-function-delta";
import { ruleExports } from "./rule-exports";
import { ruleNewFiles } from "./rule-new-files";

/**
 * 规则输入：改动清单、覆盖率索引、仓库合计与导出引用分析。规则只读这份输入，不自己
 * 读文件、不自己跑 git，保证同一份产物在本地与持续集成得到相同结论。
 */
export interface RuleInput {
  changedFiles: readonly ChangedFile[];
  coverage: ReadonlyMap<string, FileCoverage>;
  totals: CoverageTotals;
  managedFiles: readonly string[];
  /** 规则二的基准侧数据：分叉点覆盖率与两版函数结构。未接入时为 undefined。 */
  functionDelta?: FunctionDeltaData;
  /** 测试文件的导入索引：被导入文件 → 被导入的符号名。未接入时跳过被动覆盖检查。 */
  testImports?: ReadonlyMap<string, ReadonlySet<string>>;
  /** 规则三的输入：两侧导出对比、生产引用索引与基线条目。只有静态引用检查阶段提供。 */
  exportUsage?: ExportAnalysis;
}

/**
 * 一条判定结果。五项固定：规则编号、文件、参与比较的数字、判定理由、修复方向。
 * 输出格式由报告统一渲染，规则不拼文本。
 */
export interface Finding {
  rule: string;
  file: string;
  numbers: string;
  reason: string;
  fix: string;
}

export interface CoverageRule {
  id: string;
  title: string;
  evaluate(input: RuleInput): Finding[];
}

/** 规则注册表：判定顺序即数组顺序。 */
export const RULES: readonly CoverageRule[] = [ruleNewFiles, functionDeltaRule, ruleExports];

/**
 * 覆盖率判定阶段执行的规则：规则一与规则二。规则三只读源码，在测试之前单独跑，
 * 失败时省下两次测试运行。
 */
export const COVERAGE_RULES: readonly CoverageRule[] = [ruleNewFiles, functionDeltaRule];

/** 静态引用检查阶段执行的规则：只有规则三，不需要覆盖率产物。 */
export const EXPORT_RULES: readonly CoverageRule[] = [ruleExports];

/** 依次执行规则并汇总结果。`rules` 可注入，供测试使用固定样本。 */
export function evaluateRules(
  input: RuleInput,
  rules: readonly CoverageRule[] = RULES,
): Finding[] {
  return rules.flatMap((rule) => rule.evaluate(input));
}
