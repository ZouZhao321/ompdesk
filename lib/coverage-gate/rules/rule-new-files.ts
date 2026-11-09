import type { ChangedFile } from "../git";
import type { FileCoverage } from "../lcov";
import type { CoverageRule, Finding, RuleInput } from "./index";

export const RULE_NEW_FILES = "rule-1";

/**
 * 规则一：新增文件里的函数必须全部被调用；改动到的文件必须出现在覆盖率产物里。
 *
 * 两件事分开报：
 *
 * - 改动文件在产物里没有记录，说明它从未被任何测试加载，与函数调用了几个无关；
 * - 新增文件有记录但 `functionsHit < functionsFound`，说明有函数没被调用。
 *
 * `functionsFound === 0` 的新增文件（纯类型、常量表、样式）不判失败，由报告标注
 * 不适用。改名不按新增处理：改名后的路径只走「未被任何测试加载」这一条。
 */
function unloadedFinding(file: ChangedFile): Finding {
  return {
    rule: RULE_NEW_FILES,
    file: file.path,
    numbers: "产物记录 0 条（函数 0/0）",
    reason: "文件未被任何测试加载",
    fix: "补一个会 import 该文件的测试，或确认它属于受管源码",
  };
}

function uncoveredFunctionFinding(path: string, metrics: FileCoverage): Finding {
  const uncovered = metrics.functionsFound - metrics.functionsHit;
  return {
    rule: RULE_NEW_FILES,
    file: path,
    numbers: `被调用 ${metrics.functionsHit} / 总数 ${metrics.functionsFound}`,
    reason: "新增文件里有函数未被任何测试调用",
    fix: `为 ${path} 里未被调用的 ${uncovered} 个函数补测试`,
  };
}

/** 单个改动文件的判定；通过时返回 null。 */
function evaluateFile(file: ChangedFile, coverage: ReadonlyMap<string, FileCoverage>): Finding | null {
  const metrics = coverage.get(file.path);
  if (!metrics) return unloadedFinding(file);
  if (file.status !== "added") return null;
  if (metrics.functionsFound === 0) return null;
  if (metrics.functionsHit === metrics.functionsFound) return null;
  return uncoveredFunctionFinding(file.path, metrics);
}

export const ruleNewFiles: CoverageRule = {
  id: RULE_NEW_FILES,
  title: "新增文件与未加载文件必须被执行",
  evaluate(input: RuleInput): Finding[] {
    const findings: Finding[] = [];
    for (const file of input.changedFiles) {
      const finding = evaluateFile(file, input.coverage);
      if (finding) findings.push(finding);
    }
    return findings;
  },
};
