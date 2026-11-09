import type { ChangedFile } from "../git";
import type { CoverageTotals, FileCoverage } from "../lcov";

/**
 * 规则输入：改动清单、覆盖率索引与仓库合计。后续规则只读这份输入，不自己读文件、
 * 不自己跑 git，保证同一份产物在本地与持续集成得到相同结论。
 */
export interface RuleInput {
  changedFiles: readonly ChangedFile[];
  coverage: ReadonlyMap<string, FileCoverage>;
  totals: CoverageTotals;
  managedFiles: readonly string[];
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

/**
 * 规则注册表。本票据只报告数字，不启用任何规则；规则一至三在后续票据里追加到
 * 这份数组，判定顺序即数组顺序。
 */
export const RULES: readonly CoverageRule[] = [];

/** 依次执行规则并汇总结果。`rules` 可注入，供测试使用固定样本。 */
export function evaluateRules(input: RuleInput, rules: readonly CoverageRule[] = RULES): Finding[] {
  return rules.flatMap((rule) => rule.evaluate(input));
}
