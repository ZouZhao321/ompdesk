#!/usr/bin/env bun
/**
 * 开放 PR 队列体检：把「能机械解阻」与「要人决策」分开。
 *
 * 只读。PR、必需检查与未解决的讨论串走 `gh`；与 main 的差距、两两合并冲突与提交包含
 * 关系走 `git`。提交包含关系用祖先判定，不用差异比对：同一份改动被分成多个
 * 都以 main 为目标的 PR 时，只有祖先判定能认出它们其实是同一批提交。
 *
 * 用法：bun run queue [--json]
 */

import { spawnSync } from "node:child_process";
import { createGitEnv } from "../lib/git-env";
import {
  classifyPullRequest,
  collapseContained,
  orderForMerge,
  type CheckState,
  type PullRequestState,
} from "../lib/pr-queue";

interface CommandResult {
  status: number;
  stdout: string;
}

/** 跑 git；非零退出码是答案的一部分（例如 `merge-base --is-ancestor` 用 1 表示否），不抛错。 */
function runGit(args: string[]): CommandResult {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: createGitEnv(),
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

/** 跑 gh，失败即终止：读不到 PR 状态时继续算下去只会给出错误结论。 */
function runGh(args: string[]): string {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`gh ${args.join(" ")} 失败（退出码 ${result.status}）：${result.stderr}`);
  }
  return result.stdout ?? "";
}

interface OpenNode {
  number: number;
  headRefName: string;
  createdAt: string;
  mergeable: PullRequestState["mergeable"];
  mergeStateStatus: string;
  changedFiles: number;
  commits: {
    nodes: {
      commit: {
        statusCheckRollup: {
          contexts: {
            nodes: { __typename: string; name?: string; conclusion?: string | null }[];
          };
        } | null;
      };
    }[];
  };
  reviewThreads: { nodes: { isResolved: boolean }[] };
}

interface GraphqlResponse {
  data: { repository: { pullRequests: { nodes: OpenNode[] } } };
}

const OPEN_QUERY = `query {
  repository(owner: "OWNER", name: "REPO") {
    pullRequests(states: OPEN, first: 50) {
      nodes {
        number headRefName createdAt mergeable mergeStateStatus changedFiles
        commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 60) { nodes {
          __typename ... on CheckRun { name conclusion }
        } } } } } }
        reviewThreads(first: 100) { nodes { isResolved } }
      }
    }
  }
}`;

/** 试合并两个分支，返回冲突文件。不建提交、不动工作区。 */
function conflictsBetween(a: string, b: string): string[] {
  const result = runGit(["merge-tree", "--write-tree", a, b]);
  if (result.status === 0) return [];
  return [
    ...new Set([...result.stdout.matchAll(/CONFLICT \([^)]*\): (?:.*? in )?(\S+)/g)].map((match) => match[1])),
  ].sort();
}

runGit(["fetch", "origin", "--prune", "--quiet"]);

const slug = runGh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
const [owner, repo] = slug.split("/");
if (!owner || !repo) throw new Error(`认不出仓库：${slug}`);

const required = JSON.parse(
  runGh(["api", `repos/${owner}/${repo}/branches/main/protection`, "--jq", ".required_status_checks.contexts // []"]),
) as string[];

const response = JSON.parse(
  runGh(["api", "graphql", "-f", `query=${OPEN_QUERY.replace("OWNER", owner).replace("REPO", repo)}`]),
) as GraphqlResponse;
const nodes = response.data.repository.pullRequests.nodes;

const prs: PullRequestState[] = nodes.map((node) => ({
  number: node.number,
  branch: node.headRefName,
  createdAt: node.createdAt,
  mergeable: node.mergeable,
  mergeStateStatus: node.mergeStateStatus,
  checks: (node.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [])
    .filter((context) => context.__typename === "CheckRun")
    .map(
      (context): CheckState => ({
        name: context.name ?? "",
        conclusion: context.conclusion ?? null,
      }),
    ),
  conflictsWith: [],
  behindCommits: Number(runGit(["rev-list", "--count", `origin/${node.headRefName}..origin/main`]).stdout.trim()),
  unresolvedThreads: node.reviewThreads.nodes.filter((thread) => !thread.isResolved).length,
  changedFiles: node.changedFiles,
  containedIn: null,
}));

for (const pr of prs) {
  pr.conflictsWith = prs
    .filter(
      (other) =>
        other.number !== pr.number && conflictsBetween(`origin/${pr.branch}`, `origin/${other.branch}`).length > 0,
    )
    .map((other) => other.branch);
  pr.containedIn =
    prs.find(
      (other) =>
        other.number !== pr.number &&
        other.changedFiles >= pr.changedFiles &&
        runGit(["merge-base", "--is-ancestor", `origin/${pr.branch}`, `origin/${other.branch}`]).status === 0,
    )?.number ?? null;
}

const verdicts = prs.map((pr) => classifyPullRequest(pr, required));
const { groups, standalone } = collapseContained(prs);
const order = orderForMerge(prs.filter((pr) => pr.containedIn === null));

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify({ required, order, groups, standalone, verdicts }, null, 2)}\n`);
} else {
  const out: string[] = [`开放 PR ${prs.length} 个，必需检查 ${required.length} 项`, ""];

  if (groups.length > 0) {
    out.push("## 同一批提交分成的多个 PR：只合并最上面那个");
    for (const group of groups) out.push(`- #${group.tip} 已包含 #${group.subset.join("、#")}`);
    out.push("");
  }

  out.push("## 建议合并顺序（冲突少、改动小的先走）");
  for (const number of order) out.push(`- #${number}`);
  out.push("");

  const mechanical = verdicts.filter(
    (verdict) => !verdict.ready && !verdict.blockers.some((blocker) => blocker.needsDecision),
  );
  out.push(`## 可以机械解阻：${mechanical.length} 个`);
  for (const verdict of mechanical) {
    out.push(`- #${verdict.number} ${verdict.branch}`);
    for (const blocker of verdict.blockers) out.push(`    ${blocker.detail}`);
  }

  const decision = verdicts.filter((verdict) => verdict.blockers.some((blocker) => blocker.needsDecision));
  out.push("");
  out.push(`## 需要你决策：${decision.length} 个`);
  for (const verdict of decision) {
    out.push(`- #${verdict.number} ${verdict.branch}`);
    for (const blocker of verdict.blockers) {
      out.push(`    ${blocker.needsDecision ? "[决策]" : "[机械]"} ${blocker.detail}`);
    }
  }

  const ready = verdicts.filter((verdict) => verdict.ready);
  out.push("");
  out.push(`## 现在就绪：${ready.length} 个`);
  for (const verdict of ready) out.push(`- #${verdict.number} ${verdict.branch}`);
  process.stdout.write(`${out.join("\n")}\n`);
}
