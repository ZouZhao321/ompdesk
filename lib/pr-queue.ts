/**
 * 开放 PR 队列的判定规则。
 *
 * 只做判断，不读网络也不读磁盘：输入是一次探测得到的状态，输出是每个 PR 的
 * 阻塞原因、可合并的先后顺序，以及同一份改动被分成多个 PR 的归并结果。
 */

export type Mergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";

export interface CheckState {
 name: string;
 /** GitHub 的结论：SUCCESS / FAILURE / SKIPPED / CANCELLED / null（未上报）。 */
 conclusion: string | null;
}

export interface PullRequestState {
 number: number;
 branch: string;
 createdAt: string;
 mergeable: Mergeable;
 /** GitHub 的合并状态：BEHIND / DIRTY / BLOCKED / CLEAN / UNKNOWN。 */
 mergeStateStatus: string;
 checks: CheckState[];
 /** 与这个 PR 试合并会冲突的其他分支。 */
 conflictsWith: string[];
 /** 分支比 main 少多少个提交。 */
 behindCommits: number;
 unresolvedThreads: number;
 changedFiles: number;
 /** 这个 PR 的全部提交都包含在哪个开放 PR 的历史里。 */
 containedIn: number | null;
}

export type BlockerKind = "missing-checks" | "behind" | "conflict" | "failing-check" | "discussion";

export interface Blocker {
 kind: BlockerKind;
 /** 一句话说明，可直接放进汇报。 */
 detail: string;
 /** 解阻是否需要人做判断；false 表示按说明操作即可。 */
 needsDecision: boolean;
}

export interface Verdict {
 number: number;
 branch: string;
 blockers: Blocker[];
 /** 没有任何阻塞项。 */
 ready: boolean;
}

/**
 * 逐个 PR 列出阻塞原因。
 *
 * `required` 是 main 的分支保护里要求的检查名。分支里如果没有定义这些检查的
 * 工作流，它们永远不会在这个 PR 上报，合并被永久挡住——这种空等与代码质量
 * 无关，把 origin/main 合进分支就能解除。
 */
export function classifyPullRequest(pr: PullRequestState, required: string[]): Verdict {
 const blockers: Blocker[] = [];

 const reported = new Set(pr.checks.map((check) => check.name));
 // 有检查还在跑时不下「不会上报」的结论：依赖前序作业的检查（例如打包冒烟要等
 // 构建完成）此时还没出现在列表里，误报会让人去合并 main 做无用功。
 const running = pr.checks.some((check) => check.conclusion === null);
 const missing = running ? [] : required.filter((name) => !reported.has(name));
 if (missing.length > 0) {
  blockers.push({
   kind: "missing-checks",
   detail: `分支里没有产出 ${missing.length} 项必需检查（${missing.join("、")}）：把 origin/main 合进分支后它们才会开始上报`,
   needsDecision: false,
  });
 }

 if (pr.behindCommits > 0) {
  blockers.push({
   kind: "behind",
   detail: `比 main 少 ${pr.behindCommits} 个提交：合并目标要求分支最新，每次别人合并它都要重新同步`,
   needsDecision: false,
  });
 }

 if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY") {
  blockers.push({
   kind: "conflict",
   detail: pr.conflictsWith.length > 0 ? `与 ${pr.conflictsWith.join("、")} 冲突` : "与 main 冲突",
   needsDecision: false,
  });
 }

 const failed = pr.checks.filter((check) => check.conclusion === "FAILURE").map((check) => check.name);
 if (failed.length > 0) {
  blockers.push({
   kind: "failing-check",
   detail: `检查失败：${failed.join("、")}`,
   needsDecision: true,
  });
 }

 if (pr.unresolvedThreads > 0) {
  blockers.push({
   kind: "discussion",
   detail: `${pr.unresolvedThreads} 条评审讨论未标记已解决`,
   needsDecision: true,
  });
 }

 return {
  number: pr.number,
  branch: pr.branch,
  blockers,
  ready: blockers.length === 0,
 };
}

export interface ContainmentGroup {
 /** 真正需要合并的那一个。 */
 tip: number;
 /** 提交已经全部包含在 tip 里，单独合并只是重复劳动。 */
 subset: number[];
}

/**
 * 找出被其他开放 PR 完全包含的 PR。
 *
 * 同一份改动被分成多个 PR 且都以 main 为目标时，每个 PR 的差异里都带着前一个
 * 的全部提交：逐个合并会重复跑同一套检查与评审，还会互相冲突。只合并最上面的。
 */
export function collapseContained(prs: PullRequestState[]): {
 groups: ContainmentGroup[];
 standalone: number[];
} {
 const known = new Set(prs.map((pr) => pr.number));
 const parentOf = new Map<number, number>();
 for (const pr of prs) {
  if (pr.containedIn !== null && known.has(pr.containedIn)) {
   parentOf.set(pr.number, pr.containedIn);
  }
 }

 // 传递闭包：A 含于 B、B 含于 C，则 A 也含于 C。
 const topOf = (number: number): number => {
  const seen = new Set([number]);
  let current = number;
  for (; ;) {
   const parent = parentOf.get(current);
   if (parent === undefined || seen.has(parent)) return current;
   seen.add(parent);
   current = parent;
  }
 };

 const groups = new Map<number, number[]>();
 for (const number of parentOf.keys()) {
  const top = topOf(number);
  if (top === number) continue;
  groups.set(top, [...(groups.get(top) ?? []), number]);
 }

 const folded = new Set<number>([...groups.keys(), ...[...groups.values()].flat()]);
 return {
  groups: [...groups.entries()]
   .map(([tip, subset]) => ({ tip, subset: subset.sort((a, b) => a - b) }))
   .sort((a, b) => a.tip - b.tip),
  standalone: prs
   .map((pr) => pr.number)
   .filter((number) => !folded.has(number))
   .sort((a, b) => a - b),
 };
}

/**
 * 建议的合并顺序。
 *
 * 与其他分支冲突多的往后放：每合并一个，其余分支都会过期并需要重新同步，
 * 冲突最多的放在最后，前面几次同步都只碰本来就小的改动。同分按改动文件少
 * 的先走，出问题时回滚代价最小。
 */
export function orderForMerge(prs: PullRequestState[]): number[] {
 return [...prs]
  .sort((a, b) => {
   if (a.conflictsWith.length !== b.conflictsWith.length) {
    return a.conflictsWith.length - b.conflictsWith.length;
   }
   if (a.changedFiles !== b.changedFiles) return a.changedFiles - b.changedFiles;
   if (a.createdAt === b.createdAt) return a.number - b.number;
   return a.createdAt < b.createdAt ? -1 : 1;
  })
  .map((pr) => pr.number);
}
