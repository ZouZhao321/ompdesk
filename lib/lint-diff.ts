/**
 * 只检查改动行时的两个纯计算：从统一差异里取出新增行区间，以及把基准版本
 * 已有的 error 从候选里扣掉。
 *
 * 扣基准这一步是因为整文件排版会把没动过的代码也写进差异：那些行上没有引入
 * 任何新代码，却会被算成「改动行」，把基准里早有的 error 重新算一次。
 */

/** 从 `git diff -U0` 的输出里取出新增行区间，行号按新版本计算。 */
export function parseAddedRanges(diffText: string): [number, number][] {
 const ranges: [number, number][] = [];
 for (const line of diffText.split("\n")) {
  const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!match) continue;
  const start = Number(match[1]);
  const count = match[2] === undefined ? 1 : Number(match[2]);
  if (count > 0) ranges.push([start, start + count - 1]);
 }
 return ranges;
}

export interface LintMessage {
 ruleId: string | null;
 message: string;
 line?: number;
 column?: number;
 severity: number;
}

/**
 * error 的身份：规则加消息正文。
 *
 * eslint 的 message 末尾带一段代码片段（绝对路径、行号、带插入符的行），排版
 * 一改全变；丢掉这一段，剩下的正文才是问题本身——React Compiler 的判据写在
 * 正文里，换行位置不同也算同一个问题。
 */
export function errorSignature(message: LintMessage): string {
 const body: string[] = [];
 for (const line of message.message.split("\n")) {
  // 代码片段从这里开始：一行绝对路径加行号列号，或一行 `> 621 | …`。
  if (/:\d+:\d+\s*$/.test(line) || /^>\s*\d+\s*\|/.test(line)) break;
  body.push(line);
 }
 return `${message.ruleId ?? "unknown"}\u0000${body.join("\n").replace(/\s+/g, " ").trim()}`;
}

/**
 * 从候选里扣除基准版本已经存在的 error。
 *
 * 按签名计数而不是按集合去重：同一文件里同一条规则可能在多处触发，消息首行
 * 相同。基准有几条就扣几条，多出来的才算这次改动引入的。
 */
export function dropPreExisting(
 candidates: LintMessage[],
 baseline: LintMessage[],
): LintMessage[] {
 const remaining = new Map<string, number>();
 for (const message of baseline) {
  const signature = errorSignature(message);
  remaining.set(signature, (remaining.get(signature) ?? 0) + 1);
 }

 return candidates.filter((message) => {
  const signature = errorSignature(message);
  const count = remaining.get(signature) ?? 0;
  if (count === 0) return true;
  remaining.set(signature, count - 1);
  return false;
 });
}
