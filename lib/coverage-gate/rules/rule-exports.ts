import {
  BASELINE_FILE,
  baselineKey,
  referencesFor,
  type ExportDeclaration,
  type ExportKind,
  type ExportedSymbol,
} from "../exports";
import type { CoverageRule, Finding, RuleInput } from "./index";

export const RULE_EXPORTS = "rule-3";

const RULE_TITLE = "新增导出必须有生产引用";

/** 由框架按文件名或路径调用的导出，不计入判定。 */
const ROUTE_METHODS: Record<string, true> = {
  GET: true,
  POST: true,
  PATCH: true,
  DELETE: true,
  PUT: true,
  HEAD: true,
  OPTIONS: true,
};

/** 路由文件里的段配置，Next.js 直接读取，同样没有 import 语句。 */
const ROUTE_SEGMENT_CONFIG: Record<string, true> = {
  dynamic: true,
  revalidate: true,
  runtime: true,
  preferredRegion: true,
  maxDuration: true,
  fetchCache: true,
};

/** `app/` 下的约定文件：默认导出与路由段配置由框架按文件名读取。 */
const APP_PAGE_FILES: Record<string, true> = {
  page: true,
  layout: true,
  template: true,
  loading: true,
  error: true,
  "not-found": true,
  "global-error": true,
};

const APP_PAGE_EXPORTS: Record<string, true> = {
  default: true,
  metadata: true,
  generateMetadata: true,
  viewport: true,
  generateViewport: true,
  generateStaticParams: true,
  dynamicParams: true,
  ...ROUTE_SEGMENT_CONFIG,
};

/** `app/` 下的元数据路由文件，默认导出由框架调用。 */
const APP_METADATA_FILES: Record<string, true> = {
  manifest: true,
  robots: true,
  sitemap: true,
  icon: true,
  "apple-icon": true,
  "opengraph-image": true,
  "twitter-image": true,
};

/** 仓库根的工具配置，默认导出由加载器读取。 */
const CONFIG_FILES: Record<string, true> = {
  "next.config": true,
  "tailwind.config": true,
  "postcss.config": true,
  "eslint.config": true,
};

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

/** 去掉目录与最后一节扩展名：`app/x/page.tsx` → `page`，`next.config.ts` → `next.config`。 */
function baseName(file: string): string {
  return file.slice(file.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
}

/** 框架按文件名或路径调用、不需要 import 的导出。 */
export function isFrameworkExport(file: string, symbol: ExportedSymbol): boolean {
  if (file.startsWith("bin/")) return true;

  const name = baseName(file);
  if (name === "route") {
    return ROUTE_METHODS[symbol.name] === true || ROUTE_SEGMENT_CONFIG[symbol.name] === true;
  }
  if (name === "instrumentation") return symbol.name === "register" || symbol.name === "onRequestError";
  if (name === "proxy") {
    return symbol.name === "default" || symbol.name === "proxy" || symbol.name === "config";
  }
  if (file.startsWith("app/")) {
    if (APP_METADATA_FILES[name] === true && symbol.name === "default") return true;
    if (APP_PAGE_FILES[name] === true && APP_PAGE_EXPORTS[symbol.name] === true) return true;
  }
  if (symbol.name !== "default") return false;
  return CONFIG_FILES[name] === true;
}

/**
 * 规则三：新增导出必须在受管源码里有生产引用。
 *
 * 新增的判定是分叉点版本与工作区两侧的导出结构对比，只拦本次新增。上线前的存量
 * 无引用导出记录在仓库根的基线文件里，命中基线的不判失败：改名识别失败的路径只能
 * 按新增文件处理，基线让这类重构不至于把存量代码变成新的失败。
 *
 * 框架按文件名或路径调用的导出（路由方法、页面与布局的默认导出、配置文件、命令行
 * 入口）不产生 import 语句，直接跳过。仅类型导出与运行时导出分开统计，输出里带上
 * 符号的名字与声明形式。
 */
export const ruleExports: CoverageRule = {
  id: RULE_EXPORTS,
  title: RULE_TITLE,
  evaluate(input: RuleInput): Finding[] {
    const analysis = input.exportUsage;
    const findings: Finding[] = [];

    if (analysis.baselineError) {
      findings.push({
        rule: RULE_EXPORTS,
        file: BASELINE_FILE,
        numbers: "基线条目 0 条（解析失败）",
        reason: `基线文件无法解析：${analysis.baselineError}`,
        fix: `修复 ${BASELINE_FILE} 的 JSON 结构，或按说明重新生成基线`,
      });
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
        numbers: `新增运行时导出 ${count.runtime} 个、仅类型导出 ${count.type} 个；`
          + `${item.symbol.name}（${KIND_LABELS[item.symbol.kind]}）生产引用 0`,
        reason: `新增导出 ${item.symbol.name} 是${DECLARATION_LABELS[item.symbol.declaration]}，`
          + "在受管源文件里没有任何引用；测试文件不计入生产引用",
        fix: `在受管源码里使用 ${item.symbol.name}，或去掉 export；`
          + "由框架按路径调用的导出须在豁免清单登记",
      });
    }

    return findings;
  },
};
