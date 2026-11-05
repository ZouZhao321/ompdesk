import type { ExceptionEntry, ExceptionResolution } from "./exceptions";
import { EXCEPTIONS_FILE } from "./exceptions";
import type { ChangedFile, ChangeStatus } from "./git";
import type { CoverageTotals, FileCoverage } from "./lcov";
import type { Finding } from "./rules";
import type { FunctionDeltaData, FunctionDeltaRow } from "./rules/rule-function-delta";

/** 报告需要的全部数据。渲染是纯函数，便于用固定样本断言文本。 */
export interface ReportInput {
  baseRef: string;
  mergeBase: string;
  changedFiles: readonly ChangedFile[];
  coverage: ReadonlyMap<string, FileCoverage>;
  totals: CoverageTotals;
  /** 被剔除的仓库外或越界记录条数。 */
  droppedRecords: number;
  /** 同一路径重复出现而忽略的记录条数。 */
  duplicateRecords: number;
  managedFileCount: number;
  missingManagedFiles: readonly string[];
  /** 规则二的基准侧数据；没有改动文件可判时不提供。 */
  functionDelta?: FunctionDeltaData;
  /** 有效豁免已从 `findings` 里剔除，随这里的豁免段一并展示。 */
  exceptions?: ExceptionResolution;
  /** 分段耗时；命令行入口实测后传入，纯渲染的测试可以不提供。 */
  timings?: ReportTimings;
  findings: readonly Finding[];
}

/** 门禁新增步骤的耗时预算：3 分钟。超出时报告给出超出量，不改变退出码。 */
const GATE_BUDGET_MS = 180_000;

/** 三段耗时，毫秒。`testMs` 缺失表示报告不是由命令行入口产生的。 */
export interface ReportTimings {
  /** 本次带覆盖率的测试运行。 */
  testMs?: number;
  /** 分叉点基准运行；跳过时为 0。 */
  baseMs: number;
  /** 基准运行没有发生，报告里写明原因。 */
  baseSkipped: boolean;
  /** 判定分析，不含基准运行。 */
  analysisMs: number;
}

const STATUS_LABELS: Record<ChangeStatus, string> = {
  added: "新增",
  modified: "修改",
  renamed: "改名",
};

const MISSING_EXAMPLES = 3;

/** `命中/总数（百分比）`；总数为 0 时百分比记作 `—`，不除以零。 */
function ratio(hit: number, found: number): string {
  const percent = found === 0 ? "—" : `${((hit / found) * 100).toFixed(2)}%`;
  return `${hit}/${found}（${percent}）`;
}

function renderChangedFile(file: ChangedFile, coverage: ReadonlyMap<string, FileCoverage>): string {
  const label = STATUS_LABELS[file.status];
  const path = file.previousPath ? `${file.path} ← ${file.previousPath}` : file.path;
  const metrics = coverage.get(file.path);
  const detail = metrics
    ? `行 ${ratio(metrics.linesHit, metrics.linesFound)} · 函数 ${ratio(metrics.functionsHit, metrics.functionsFound)}`
    : "行 0/0（未加载） · 函数 0/0（未加载）";
  // 纯类型、常量表与样式的新增文件没有函数可调用，规则一不适用，如实标注。
  const applicability = metrics && file.status === "added" && metrics.functionsFound === 0
    ? " · 规则一不适用（零函数）"
    : "";
  return `  ${label}  ${path} · ${detail}${applicability}`;
}

function renderFunctionDeltaRow(row: FunctionDeltaRow): string {
  const hitDelta = row.headHit - row.baseHit;
  const parts = [
    `改动前 ${row.baseHit}/${row.baseFound}`,
    `改动后 ${row.headHit}/${row.headFound}`,
    `新增 ${row.added.length}`,
    `删除 ${row.removed.length}`,
    `被调用数 ${hitDelta >= 0 ? "+" : ""}${hitDelta}`,
  ];
  if (row.addedReExports.length > 0 || row.removedReExports.length > 0) {
    parts.push(
      `重导出 +${row.addedReExports.length}/-${row.removedReExports.length}`,
    );
  }
  if (row.baseSourceMissing) parts.push("分叉点版本读不到");
  if (row.exemptReason !== undefined) parts.push(`规则二豁免：${row.exemptReason}`);
  return `  ${row.file} · ${parts.join(" · ")}`;
}

function renderFunctionDelta(data: FunctionDeltaData): string[] {
  const lines = [`函数增量（相对分叉点 ${data.mergeBase.slice(0, 7)}）`];
  if (!data.baseCoverage.ok) {
    // 基准缺失时两侧数字不可比，只说明原因，不打印半边为 0 的对照。
    lines.push(`  基准覆盖率不可用（流水线问题）：${data.baseCoverage.detail}`);
    return lines;
  }

  lines.push(
    `  基准覆盖率现场生成，耗时 ${(data.baseCoverage.durationMs / 1000).toFixed(1)} 秒`,
  );
  for (const row of data.rows) lines.push(renderFunctionDeltaRow(row));
  if (data.rows.length === 0) lines.push("  没有需要比对的改动文件");

  if (data.notes.length > 0) {
    lines.push("", "规则二失真处理");
    for (const note of data.notes) {
      lines.push(`  [${note.label}] ${note.file} · ${note.numbers}`);
      lines.push(`       原因：${note.reason}`);
      lines.push(`       处理：${note.fix}`);
    }
  }
  return lines;
}

function renderFinding(finding: Finding): string[] {
  return [
    `  [${finding.rule}] ${finding.file}`,
    `       数字：${finding.numbers}`,
    `       理由：${finding.reason}`,
    `       修复：${finding.fix}`,
  ];
}

function renderExceptionEntry(entry: ExceptionEntry, suffix = ""): string[] {
  return [
    `    [${entry.rule}] ${entry.file} · 到期 ${entry.expiresOn}${suffix}`,
    `      理由：${entry.reason}`,
    `      替代验证：${entry.verification}`,
  ];
}

function renderExceptions(resolution: ExceptionResolution): string[] {
  const lines = [`豁免清单（${EXCEPTIONS_FILE}，复核日期 ${resolution.today}）`];
  if (!resolution.present) {
    lines.push("  清单文件不存在，按没有登记处理。");
    return lines;
  }

  if (
    resolution.active.length === 0
    && resolution.expired.length === 0
    && resolution.problems.length === 0
  ) {
    lines.push("  没有登记豁免。");
    return lines;
  }

  if (resolution.active.length > 0) {
    lines.push(`  生效 ${resolution.active.length} 条（对应判定不阻断）`);
    for (const entry of resolution.active) {
      lines.push(...renderExceptionEntry(entry));
      for (const finding of entry.suppressed) {
        lines.push(`      放行：${finding.numbers} · ${finding.reason}`);
      }
    }
  }

  if (resolution.expired.length > 0) {
    lines.push(`  已到期 ${resolution.expired.length} 条（规则重新拦截）`);
    for (const entry of resolution.expired) {
      lines.push(...renderExceptionEntry(entry, "（已到期）"));
    }
  }

  if (resolution.problems.length > 0) {
    lines.push(`  校验失败 ${resolution.problems.length} 条（退出码非零）`);
    for (const problem of resolution.problems) {
      lines.push(problem.index === 0 ? `    清单整体：${problem.message}` : `    ${problem.message}`);
    }
  }

  return lines;
}

/** 秒保留一位小数，三段的单位与粒度一致。 */
function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} 秒`;
}

/**
 * 分段耗时：本次测试运行、基准运行、分析。门禁新增的步骤就是这三段，合计与预算放在
 * 最后一行；超出预算时单独说明超出量，便于先定位最慢的一段。
 */
function renderTimings(timings: ReportTimings): string[] {
  const total = (timings.testMs ?? 0) + timings.baseMs + timings.analysisMs;
  const lines = [
    "耗时",
    timings.testMs === undefined
      ? "  本次测试运行 —（报告不是由命令行入口产生）"
      : `  本次测试运行 ${seconds(timings.testMs)}`,
    timings.baseSkipped
      ? "  基准运行 —（本次没有需要比对的改动文件，跳过）"
      : `  基准运行 ${seconds(timings.baseMs)}`,
    `  分析 ${seconds(timings.analysisMs)}（不含基准运行）`,
    `  门禁合计 ${seconds(total)}，预算 ${seconds(GATE_BUDGET_MS)}`,
  ];
  if (total > GATE_BUDGET_MS) {
    lines.push(`  超出预算 ${seconds(total - GATE_BUDGET_MS)}：按上方分段定位最慢的一段`);
  }
  return lines;
}

/** 把一次门禁运行的数据渲染成一段可直接贴进检查日志的文本。 */
export function renderReport(input: ReportInput): string {
  const failed = input.findings.length > 0;
  const exceptionProblems = input.exceptions?.problems.length ?? 0;
  const lines: string[] = [
    failed
      ? "覆盖率门禁（本次有判定未通过）"
      : exceptionProblems > 0
        ? "覆盖率门禁（豁免清单校验未通过）"
        : "覆盖率门禁",
    `基准 ${input.baseRef}，分叉点 ${input.mergeBase.slice(0, 7)}`,
    "",
    `改动文件：${input.changedFiles.length} 个受管源文件`,
  ];

  for (const file of input.changedFiles) lines.push(renderChangedFile(file, input.coverage));

  if (input.functionDelta) {
    lines.push("", ...renderFunctionDelta(input.functionDelta));
  }

  lines.push(
    "",
    "仓库内合计（加权）",
    `  行覆盖 ${ratio(input.totals.linesHit, input.totals.linesFound)}`,
    `  函数覆盖 ${ratio(input.totals.functionsHit, input.totals.functionsFound)}`,
    "",
    "覆盖率记录",
    `  仓库外或越界记录剔除 ${input.droppedRecords} 条`,
    `  重复路径去重忽略 ${input.duplicateRecords} 条`,
    "",
    `报告缺席的受管源文件：${input.missingManagedFiles.length}/${input.managedFileCount}`,
  );

  const examples = input.missingManagedFiles.slice(0, MISSING_EXAMPLES);
  for (const path of examples) lines.push(`  ${path}`);
  const remaining = input.missingManagedFiles.length - examples.length;
  if (remaining > 0) lines.push(`  另有 ${remaining} 个。`);

  lines.push("", `规则判定：${input.findings.length} 条`);
  for (const finding of input.findings) lines.push(...renderFinding(finding));

  if (input.exceptions) lines.push("", ...renderExceptions(input.exceptions));
  if (input.timings) lines.push("", ...renderTimings(input.timings));

  const findings = input.findings.length;
  lines.push(
    "",
    findings > 0 && exceptionProblems > 0
      ? `本次 ${findings} 条判定未通过，豁免清单 ${exceptionProblems} 条校验失败，退出码非零。`
      : findings > 0
        ? `本次 ${findings} 条判定未通过，退出码非零。`
        : exceptionProblems > 0
          ? `豁免清单 ${exceptionProblems} 条校验失败，退出码非零。`
          : "本次没有判定结果，退出码为 0。",
  );
  return lines.join("\n");
}
