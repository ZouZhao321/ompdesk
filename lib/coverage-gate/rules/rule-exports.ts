import { BASELINE_FILE, baselineKey } from "../export-baseline";
import { referencesFor, type ExportDeclaration, type ExportKind } from "../exports";
import { isFrameworkExport } from "../framework-exports";
import type { CoverageRule, Finding, RuleInput } from "./index";

const RULE_EXPORTS = "rule-3";

const RULE_TITLE = "新增导出必须有生产引用";

const KIND_LABELS: Record<ExportKind, string> = {
  runtime: "运行时导出",
  type: "仅类型导出",
};

const DECLARATION_LABELS: Record<ExportDeclaration, string> = {
  function: "函数",
  class: "类",
  variable: "常量",
  enum: "枚举",
  namespace: "命名空间",
  type: "类型",
  interface: "接口",
  default: "默认导出",
  alias: "重命名导出",
  "re-export": "转出导出",
};

/**
 * 规则三：新增导出必须在受管源码里有生产引用。
 *
 * 新增的判定是分叉点版本与工作区两侧的导出结构对比，只拦本次新增。分叉点之前就存在
 * 的无引用导出记录在仓库根的基线文件里，命中基线的不判失败：改名识别失败的路径只能
 * 按新增文件处理，基线让这类重构不至于把存量代码变成新的失败。基线只豁免分叉点
 * 之前就存在的符号，本次新增的导出即便写进基线也不放行，规则不能靠改基线自我豁免。
 *
 * 框架按文件名或路径调用的导出（路由方法、页面与布局的默认导出、配置文件、命令行
 * 入口）不产生 import 语句，直接跳过。仅类型导出与运行时导出分开统计，输出里带上
 * 符号的名字与声明形式。
 *
 * 引用索引读不全时不做逐符号判定，只报一条流水线问题，检查随之变红：拿不完整的数据
 * 判定会把「没读到引用」当成「没有引用」。
 *
 * 这条规则不读覆盖率产物，它在测试之前单独跑：`bun run coverage:exports`。静态失败时
 * 省下两次测试运行。
 */
export const ruleExports: CoverageRule = {
  id: RULE_EXPORTS,
  title: RULE_TITLE,
  evaluate(input: RuleInput): Finding[] {
    const analysis = input.exportUsage;
    const findings: Finding[] = [];
    if (!analysis) {
      return [
        {
          rule: RULE_EXPORTS,
          file: "（导出引用分析）",
          numbers: "没有导出分析数据",
          reason: "规则三没有拿到导出引用分析，无法判定，属流水线问题",
          fix: "确认 bun run coverage:exports 接入了导出分析后再重跑",
        },
      ];
    }

    if (analysis.baselineError) {
      findings.push({
        rule: RULE_EXPORTS,
        file: BASELINE_FILE,
        numbers: "基线条目 0 条（解析失败）",
        reason: `基线文件无法解析：${analysis.baselineError}`,
        fix: `修复 ${BASELINE_FILE} 的 JSON 结构，或按说明重新生成基线`,
      });
    }

    if (analysis.analysisError !== undefined) {
      findings.push({
        rule: RULE_EXPORTS,
        file: "（导出分析）",
        numbers: "导出引用分析未完成，没有判定数据",
        reason: `规则三无法判定，属流水线问题：${analysis.analysisError}`,
        fix: "按上面的原因排查导出分析（基线读取、目录权限或 CLI 环境），修好后重跑覆盖率门禁",
      });
      return findings;
    }

    if (analysis.readFailures.length > 0) {
      findings.push({
        rule: RULE_EXPORTS,
        file: "（受管源文件）",
        numbers: `读取失败 ${analysis.readFailures.length} 处，判定数据不全`,
        reason: `规则三无法判定，属流水线问题：${analysis.readFailures.join("；")}`,
        fix:
          "确认这些文件存在且可读；工作区里已删除的文件先提交删除；" +
          "分叉点版本读不到时确认检出带完整历史（fetch-depth: 0）",
      });
      return findings;
    }

    const judged = analysis.added.filter((item) => !isFrameworkExport(item.file, item.symbol));
    const counts = new Map<string, Record<ExportKind, number>>();
    for (const item of judged) {
      const entry = counts.get(item.file) ?? { runtime: 0, type: 0 };
      entry[item.symbol.kind] += 1;
      counts.set(item.file, entry);
    }

    for (const item of judged) {
      if (analysis.baseline.has(baselineKey(item.file, item.symbol.name, item.symbol.kind))) continue;
      if (referencesFor(analysis.references, item.file, item.symbol.name).length > 0) continue;

      const count = counts.get(item.file) ?? { runtime: 0, type: 0 };
      findings.push({
        rule: RULE_EXPORTS,
        file: item.file,
        numbers:
          `新增运行时导出 ${count.runtime} 个、仅类型导出 ${count.type} 个；` +
          `${item.symbol.name}（${KIND_LABELS[item.symbol.kind]}）生产引用 0`,
        reason:
          `新增导出 ${item.symbol.name} 是${DECLARATION_LABELS[item.symbol.declaration]}，` +
          "在受管源文件里没有任何引用；测试文件不计入生产引用",
        fix: `在受管源码里使用 ${item.symbol.name}，或去掉 export；` + "由框架按路径调用的导出须在豁免清单登记",
      });
    }

    return findings;
  },
};
