/**
 * Plane 与 GitHub PR 之间的映射规则。
 *
 * Plane 是工作项的唯一来源，PR 只是实现载体。关联键存在 Plane 一侧：
 * `external_source` 固定为 `github-pr`，`external_id` 是 `仓库#PR号`。
 * 查找走 Plane 的 issues 接口，两个参数同时给才生效（只给 external_id 会被忽略）。
 *
 * 这里只放纯函数，读写 Plane 与 GitHub 的部分在 scripts/plane-sync.ts。
 */

export const LINK_SOURCE = "github-pr";

/** Plane 工作项在同步里需要的字段。 */
export interface WorkItemRef {
  id: string;
  sequenceId: number;
  name: string;
  stateId: string;
  externalId: string | null;
}

/** GitHub PR 在同步里需要的字段。 */
export interface PullRequestRef {
  number: number;
  title: string;
  /** OPEN / CLOSED / MERGED */
  state: string;
  mergedAt: string | null;
  updatedAt: string;
  url: string;
}

type PlanStateName = "Todo" | "In Progress" | "Done";

/** PR 与工作项之间的关联键。 */
export function externalIdFor(repo: string, prNumber: number): string {
  return `${repo}#${prNumber}`;
}

/** 去掉类型前缀、WIP 标记与所有分隔符，只留下用于比较的正文。 */
function normalizeTitle(title: string): string {
  return title
    .replace(/^\[wip\]\s*/i, "")
    .replace(/^[a-z]+(?:\([^)]*\))?:\s*/i, "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

/** 字符二元组 Dice 系数，0 表示无关，1 表示完全相同。 */
function titleSimilarity(a: string, b: string): number {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  if (left.length < 2 || right.length < 2) return left === right ? 1 : 0;

  const bigrams = (text: string) => {
    const counts = new Map<string, number>();
    for (let index = 0; index < text.length - 1; index += 1) {
      const gram = text.slice(index, index + 2);
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
    return counts;
  };

  const leftGrams = bigrams(left);
  const rightGrams = bigrams(right);
  let shared = 0;
  for (const [gram, count] of leftGrams) shared += Math.min(count, rightGrams.get(gram) ?? 0);
  return (2 * shared) / (left.length - 1 + (right.length - 1));
}

/** PR 状态决定工作项应该落在哪一列。 */
export function desiredStateName(pr: PullRequestRef): PlanStateName {
  if (pr.state === "MERGED") return "Done";
  if (pr.state === "OPEN") return "In Progress";
  return "Todo";
}

interface Match {
  pr: PullRequestRef;
  score: number;
}

/** 按标题相似度给 PR 排序；分数相同按编号新的在前，保证结果稳定。 */
function rankMatches(title: string, prs: PullRequestRef[]): Match[] {
  return prs
    .map((pr) => ({ pr, score: titleSimilarity(title, pr.title) }))
    .sort((left, right) => right.score - left.score || right.pr.number - left.pr.number);
}

/** 最高分与次高分差距不足 0.1 时视为多个候选，交给人判断。 */
function isAmbiguous(matches: Match[]): boolean {
  if (matches.length < 2) return false;
  return matches[0].score - matches[1].score < 0.1;
}

interface ItemMatch {
  item: WorkItemRef;
  score: number;
}

/** 给一个 PR 标题找最接近的工作项，用于“这个 PR 是不是已经有项”。 */
export function rankItemMatches(title: string, items: WorkItemRef[]): ItemMatch[] {
  return items
    .map((item) => ({ item, score: titleSimilarity(title, item.name) }))
    .sort((left, right) => right.score - left.score || right.item.sequenceId - left.item.sequenceId);
}

type BackfillVerdict = "link" | "review" | "none";

export interface BackfillSuggestion {
  item: WorkItemRef;
  match: Match | null;
  verdict: BackfillVerdict;
}

/**
 * 给还没有关联键的工作项找候选 PR。
 *
 * 每个 PR 只分给一个工作项：按分数从高到低分配，已分配过的 PR 不再参与。
 * 阈值：≥0.9 且不并列直接可写；0.5–0.9 或并列交给人工；低于 0.5 不写。
 */
export function planBackfill(prs: PullRequestRef[], items: WorkItemRef[]): BackfillSuggestion[] {
  const used = new Set<number>();
  const suggestions: BackfillSuggestion[] = [];

  for (const item of items.filter((entry) => !entry.externalId)) {
    const remaining = prs.filter((pr) => !used.has(pr.number));
    const ranked = rankMatches(item.name, remaining);
    if (ranked.length === 0 || ranked[0].score < 0.5) {
      suggestions.push({ item, match: null, verdict: "none" });
      continue;
    }
    const ambiguous = isAmbiguous(ranked);
    const verdict: BackfillVerdict = ranked[0].score >= 0.9 && !ambiguous ? "link" : "review";
    if (verdict === "link") used.add(ranked[0].pr.number);
    suggestions.push({ item, match: ranked[0], verdict });
  }

  return suggestions.sort((left, right) => right.item.sequenceId - left.item.sequenceId);
}
