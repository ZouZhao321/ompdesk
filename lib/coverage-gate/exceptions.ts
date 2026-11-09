/**
 * 豁免清单：作者按「文件 + 规则」登记书面豁免，写清理由、替代验证方式与到期日。
 *
 * 清单文件放在仓库根，文件名 `coverage-exceptions.json`，结构如下：
 *
 * ```json
 * {
 *   "exceptions": [
 *     {
 *       "file": "lib/legacy/theme.ts",
 *       "rule": "rule-1",
 *       "reason": "只做类型声明，测试运行时不会加载",
 *       "verification": "bun run typecheck 覆盖该文件的类型错误",
 *       "expiresOn": "2026-12-31"
 *     }
 *   ]
 * }
 * ```
 *
 * 五个字段都必填，且都不能是空字符串：
 *
 * - `file`：受管源文件路径，相对仓库根，`/` 分隔；反斜杠与开头的 `./` 会被归一化；
 * - `rule`：规则编号，取 `RULES` 里的 id；
 * - `reason`：豁免理由；
 * - `verification`：替代验证方式，豁免期间靠什么保证这个文件的质量；
 * - `expiresOn`：到期日 `YYYY-MM-DD`，当天仍然生效，次日起规则重新拦截。
 *
 * 文件不存在等价于没有登记豁免。解析与校验都是纯函数：清单文本与「今天」由调用方
 * 给出，同一份清单在任何机器、任何时间得到相同结论。
 *
 * 校验失败（字段缺失、空字符串、规则编号不存在、日期不合法、同文件同规则重复登记）
 * 不抛异常：每一条都带着序号返回，报告单独成段，退出码非零。
 */

import { RULES } from "./rules";
import type { Finding } from "./rules";

/** 清单文件放在仓库根。 */
export const EXCEPTIONS_FILE = "coverage-exceptions.json";

interface CoverageException {
  /** 受管源文件路径，相对仓库根，`/` 分隔。 */
  file: string;
  /** 规则编号。 */
  rule: string;
  reason: string;
  /** 替代验证方式。 */
  verification: string;
  /** 到期日 `YYYY-MM-DD`，当天有效。 */
  expiresOn: string;
}

/** 带序号的条目；序号从 1 开始，与清单数组的顺序一致，用来定位校验失败。 */
export interface ExceptionEntry extends CoverageException {
  index: number;
}

interface ActiveException extends ExceptionEntry {
  /** 被这条豁免放行的判定；规则本来没拦这个文件时为空。 */
  suppressed: readonly Finding[];
}

/** 已到期的条目不再放行任何判定，规则按原样拦截。 */
type ExpiredException = ExceptionEntry;

interface ExceptionProblem {
  /** 条目序号；整份清单不可解析时为 0。 */
  index: number;
  message: string;
}

export interface ExceptionResolution {
  /** 清单文件是否存在。 */
  present: boolean;
  /** 复核日期 `YYYY-MM-DD`，日期比较的基准。 */
  today: string;
  active: ActiveException[];
  expired: ExpiredException[];
  /** 校验失败条目；任意一条都让退出码非零。调用方可以追加读取失败。 */
  problems: ExceptionProblem[];
}

interface AppliedExceptions {
  /** 去掉有效豁免之后的判定，只有这些参与退出码。 */
  blocking: readonly Finding[];
  /** 带上被放行判定的完整豁免结果，供报告渲染。 */
  exceptions: ExceptionResolution;
}

/** 字段顺序即报告与校验错误的顺序。 */
const FIELDS = [
  ["file", "文件"],
  ["rule", "规则编号"],
  ["reason", "理由"],
  ["verification", "替代验证方式"],
  ["expiresOn", "到期日"],
] as const;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** 本地日历日期，`YYYY-MM-DD`。清单的到期日按自然日比较，不看时区与时刻。 */
export function localTodayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * `YYYY-MM-DD` 换成自纪元起的整数天；格式或日历日期不合法时返回 null。
 * 用整数天比较，绕开时区与夏令时把两天差算成 23 或 25 小时的问题。
 */
function dayNumber(value: string): number | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const date = new Date(utc);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return utc / MS_PER_DAY;
}

/** 清单与判定里的路径统一成 `/` 分隔、不带 `./` 前缀。 */
function normalizePath(value: string): string {
  const slashed = value.replace(/\\/g, "/");
  return slashed.startsWith("./") ? slashed.slice(2) : slashed;
}

/** 豁免与判定的配对键：文件与规则同时相同才配对。 */
function exceptionKey(file: string, rule: string): string {
  return `${file}#${rule}`;
}

/**
 * 逐字段读取一条登记。任何字段不合法都记一条问题并返回 null，由调用方跳过这条。
 */
function readEntry(
  raw: Record<string, unknown>,
  index: number,
  problems: ExceptionProblem[],
): CoverageException | null {
  const values = new Map<string, string>();
  let broken = false;

  for (const [field, label] of FIELDS) {
    const value = raw[field];
    if (value === undefined) {
      problems.push({ index, message: `第 ${index} 条缺少字段 ${field}（${label}）` });
      broken = true;
      continue;
    }
    if (typeof value !== "string") {
      problems.push({ index, message: `第 ${index} 条的 ${field}（${label}）必须是字符串` });
      broken = true;
      continue;
    }
    if (value.trim() === "") {
      problems.push({ index, message: `第 ${index} 条的 ${field}（${label}）是空字符串` });
      broken = true;
      continue;
    }
    values.set(field, value.trim());
  }

  if (broken) return null;

  const file = normalizePath(values.get("file") ?? "");
  if (file.startsWith("/") || /^[A-Za-z]:/.test(file) || file.split("/").includes("..")) {
    problems.push({ index, message: `第 ${index} 条的 file（文件）必须是相对仓库根的路径：${file}` });
    return null;
  }

  return {
    file,
    rule: values.get("rule") ?? "",
    reason: values.get("reason") ?? "",
    verification: values.get("verification") ?? "",
    expiresOn: values.get("expiresOn") ?? "",
  };
}

/**
 * 解析并校验豁免清单。`text` 为 null 表示文件不存在。
 *
 * 每条登记要么进入 `active`（到期日当天及以后仍有效）要么进入 `expired`（次日起失效），
 * 要么记一条 `problems`。同文件同规则重复登记：第一条按日期归类，后续条目记问题。
 */
export function resolveExceptions(text: string | null, today: string = localTodayIso()): ExceptionResolution {
  const resolution: ExceptionResolution = {
    present: text !== null,
    today,
    active: [],
    expired: [],
    problems: [],
  };
  if (text === null) return resolution;

  const todayDay = dayNumber(today);
  if (todayDay === null) {
    throw new Error(`当前日期不合法：${today}，需为 YYYY-MM-DD`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    resolution.problems.push({
      index: 0,
      message: `不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
    });
    return resolution;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    resolution.problems.push({ index: 0, message: "顶层必须是对象" });
    return resolution;
  }
  const raw = "exceptions" in parsed ? parsed.exceptions : undefined;
  if (!Array.isArray(raw)) {
    resolution.problems.push({ index: 0, message: "缺少 exceptions 数组" });
    return resolution;
  }

  const ruleIds = new Set(RULES.map((rule) => rule.id));
  const firstIndexByKey = new Map<string, number>();

  raw.forEach((rawEntry, offset) => {
    const index = offset + 1;
    if (typeof rawEntry !== "object" || rawEntry === null || Array.isArray(rawEntry)) {
      resolution.problems.push({ index, message: `第 ${index} 条不是对象` });
      return;
    }

    const entry = readEntry(rawEntry as Record<string, unknown>, index, resolution.problems);
    if (entry === null) return;

    if (!ruleIds.has(entry.rule)) {
      resolution.problems.push({
        index,
        message: `第 ${index} 条的 rule（规则编号）${entry.rule} 不存在，` + `可用：${[...ruleIds].join("、")}`,
      });
      return;
    }

    const expiryDay = dayNumber(entry.expiresOn);
    if (expiryDay === null) {
      resolution.problems.push({
        index,
        message: `第 ${index} 条的 expiresOn（到期日）${entry.expiresOn} 不合法，` + "需为 YYYY-MM-DD 且是真实日期",
      });
      return;
    }

    const key = exceptionKey(entry.file, entry.rule);
    const firstIndex = firstIndexByKey.get(key);
    if (firstIndex !== undefined) {
      resolution.problems.push({
        index,
        message: `第 ${index} 条与第 ${firstIndex} 条重复登记 ${entry.file} 的 ${entry.rule}`,
      });
      return;
    }
    firstIndexByKey.set(key, index);

    if (expiryDay < todayDay) {
      resolution.expired.push({ index, ...entry });
    } else {
      resolution.active.push({ index, ...entry, suppressed: [] });
    }
  });

  return resolution;
}

/**
 * 把有效豁免套到判定上。只有文件与规则都相同的判定被放行，其余原样保留；
 * 已到期的条目不放行任何判定。
 */
export function applyExceptions(findings: readonly Finding[], resolution: ExceptionResolution): AppliedExceptions {
  const activeByKey = new Map(resolution.active.map((entry) => [exceptionKey(entry.file, entry.rule), entry] as const));
  const suppressed = new Map<string, Finding[]>();
  const blocking: Finding[] = [];

  for (const finding of findings) {
    const key = exceptionKey(normalizePath(finding.file), finding.rule);
    if (!activeByKey.has(key)) {
      blocking.push(finding);
      continue;
    }
    const list = suppressed.get(key) ?? [];
    list.push(finding);
    suppressed.set(key, list);
  }

  const active = resolution.active.map((entry) => ({
    ...entry,
    suppressed: suppressed.get(exceptionKey(entry.file, entry.rule)) ?? [],
  }));

  return { blocking, exceptions: { ...resolution, active } };
}
