#!/usr/bin/env bun
/**
 * 把 GitHub PR 的状态同步到 Plane 工作项。
 *
 * Plane 跑在本机，GitHub 托管的 runner 访问不到，所以由本机的计划任务执行：
 *
 *   bun run plane --backfill            # 只打印候选，不写
 *   bun run plane --backfill --apply    # 给已有工作项补关联键
 *   bun run plane                       # 打印需要改的状态
 *   bun run plane --apply               # 写状态
 *   bun run plane --apply --create      # 没有工作项的 PR 也自动建一条
 *
 * 关联键在 Plane 一侧：external_source=github-pr，external_id=仓库#PR号。
 * 查找必须两个参数一起给，只给 external_id 时 Plane 会忽略过滤条件返回全量。
 *
 * 环境变量：PLANE_API_KEY（必填）、PLANE_BASE_URL、PLANE_WORKSPACE_SLUG、PLANE_PROJECT_ID。
 */

import { execFileSync } from "node:child_process";
import {
  LINK_SOURCE,
  desiredStateName,
  externalIdFor,
  planBackfill,
  rankItemMatches,
  type BackfillSuggestion,
  type PullRequestRef,
  type WorkItemRef,
} from "../lib/plane-sync";

const BASE_URL = process.env.PLANE_BASE_URL ?? "http://127.0.0.1:18081";
const WORKSPACE = process.env.PLANE_WORKSPACE_SLUG ?? "ompdesk";
const PROJECT_ID = process.env.PLANE_PROJECT_ID ?? "e37777ec-a2ab-4cdf-b7f4-752bb3f02dc2";
const API_KEY = process.env.PLANE_API_KEY ?? "";

const ISSUES_URL = `${BASE_URL}/api/v1/workspaces/${WORKSPACE}/projects/${PROJECT_ID}/issues/`;
const STATES_URL = `${BASE_URL}/api/v1/workspaces/${WORKSPACE}/projects/${PROJECT_ID}/states/`;

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const BACKFILL = argv.includes("--backfill");
const CREATE = argv.includes("--create");
const DAYS = Number(argv[argv.indexOf("--days") + 1]) || 30;

interface PlanePage<T> {
  results: T[];
  next_cursor: string | null;
  next_page_results: boolean;
}

interface PlaneIssue {
  id: string;
  sequence_id: number;
  name: string;
  state: string;
  external_source: string | null;
  external_id: string | null;
}

interface PlaneState {
  id: string;
  name: string;
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { "X-API-Key": API_KEY, "Content-Type": "application/json", ...init?.headers },
  });
}

async function listAll<T>(url: string): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | null = null;
  for (;;) {
    const pageUrl = cursor ? `${url}?per_page=100&cursor=${encodeURIComponent(cursor)}` : `${url}?per_page=100`;
    const response = await request(pageUrl);
    if (!response.ok) throw new Error(`Plane ${response.status} ${pageUrl}`);
    const page = (await response.json()) as PlanePage<T>;
    all.push(...page.results);
    if (!page.next_page_results || !page.next_cursor) return all;
    cursor = page.next_cursor;
  }
}

function toWorkItem(issue: PlaneIssue): WorkItemRef {
  return {
    id: issue.id,
    sequenceId: issue.sequence_id,
    name: issue.name,
    stateId: issue.state,
    externalId: issue.external_id,
  };
}

function repoName(): string {
  return execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], {
    encoding: "utf8",
  }).trim();
}

function listPullRequests(days = DAYS): PullRequestRef[] {
  const raw = execFileSync(
    "gh",
    ["pr", "list", "--state", "all", "--limit", "500", "--json", "number,title,state,mergedAt,updatedAt,url"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const prs = JSON.parse(raw) as PullRequestRef[];
  if (days <= 0) return prs;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return prs.filter((pr) => Date.parse(pr.updatedAt) >= cutoff);
}

function printBackfill(suggestions: BackfillSuggestion[]): void {
  const counts = { link: 0, review: 0, none: 0 };
  for (const entry of suggestions) {
    const match = entry.match ? `#${entry.match.pr.number} (${entry.match.score.toFixed(2)})` : "-";
    const flag = { link: "写入", review: "待确认", none: "无可写" }[entry.verdict];
    counts[entry.verdict] += 1;
    console.log(`OMPDESK-${entry.item.sequenceId}\t${flag}\t${match}\t${entry.item.name}`);
  }
  console.log(`\n可自动写入 ${counts.link} 条，待人工确认 ${counts.review} 条，无匹配 ${counts.none} 条`);
}

async function backfill(): Promise<void> {
  const items = (await listAll<PlaneIssue>(ISSUES_URL)).map(toWorkItem);
  const prs = listPullRequests(0);
  const suggestions = planBackfill(prs, items);
  printBackfill(suggestions);

  if (!APPLY) return;
  const name = repoName();
  for (const entry of suggestions) {
    if (entry.verdict !== "link" || !entry.match) continue;
    const id = externalIdFor(name, entry.match.pr.number);
    const response = await request(`${ISSUES_URL}${entry.item.id}/`, {
      method: "PATCH",
      body: JSON.stringify({ external_source: LINK_SOURCE, external_id: id }),
    });
    if (!response.ok) throw new Error(`Plane ${response.status} backfill OMPDESK-${entry.item.sequenceId}`);
    console.log(`已关联 OMPDESK-${entry.item.sequenceId} ← ${id}`);
  }
}

async function sync(states: PlaneState[]): Promise<void> {
  const name = repoName();
  const prs = listPullRequests();
  const stateIdByName = new Map(states.map((state) => [state.name, state.id]));
  const stateNameById = new Map(states.map((state) => [state.id, state.name]));
  const issues = await listAll<PlaneIssue>(ISSUES_URL);
  const items = issues.map(toWorkItem);
  const linkedByKey = new Map<string, PlaneIssue>();
  for (const issue of issues) {
    if (!issue.external_id) continue;
    if (linkedByKey.has(issue.external_id)) {
      console.error(
        `重复关联键 ${issue.external_id}，先使用 OMPDESK-${linkedByKey.get(issue.external_id)?.sequence_id}`,
      );
      continue;
    }
    linkedByKey.set(issue.external_id, issue);
  }
  let changed = 0;

  for (const pr of prs) {
    const desired = desiredStateName(pr);
    const desiredId = stateIdByName.get(desired);
    if (!desiredId) throw new Error(`Plane 里没有名为「${desired}」的状态`);

    const linked = linkedByKey.get(externalIdFor(name, pr.number));
    if (!linked) {
      const ranked = rankItemMatches(pr.title, items);
      const candidates = ranked
        .slice(0, 3)
        .map((match) => `OMPDESK-${match.item.sequenceId} ${match.score.toFixed(2)}`);
      console.log(`#${pr.number}\t无工作项\t${pr.title}\t候选 ${candidates.join(", ") || "无"}`);
      if (!APPLY || !CREATE) continue;
      const response = await request(ISSUES_URL, {
        method: "POST",
        body: JSON.stringify({
          name: pr.title.replace(/^\[wip\]\s*/i, ""),
          state: desiredId,
          external_source: LINK_SOURCE,
          external_id: externalIdFor(name, pr.number),
          description_html: `<p><a href="${pr.url}">${pr.url}</a></p>`,
        }),
      });
      if (!response.ok) throw new Error(`Plane ${response.status} create #${pr.number}`);
      console.log(`已建项 ${pr.title}`);
      changed += 1;
      continue;
    }

    if (linked.state === desiredId) continue;
    // 取消过的项保持取消：PR 关掉不等于这件事还要做。
    if (stateNameById.get(linked.state) === "Cancelled" && desired === "Todo") continue;
    console.log(`OMPDESK-${linked.sequence_id}\t→ ${desired}\t${pr.title}`);
    if (!APPLY) continue;
    const response = await request(`${ISSUES_URL}${linked.id}/`, {
      method: "PATCH",
      body: JSON.stringify({ state: desiredId }),
    });
    if (!response.ok) throw new Error(`Plane ${response.status} update OMPDESK-${linked.sequence_id}`);
    changed += 1;
  }

  console.log(`\n${APPLY ? "已写入" : "待写入"} ${changed} 条`);
}

async function main(): Promise<void> {
  if (!API_KEY) throw new Error("缺少 PLANE_API_KEY");
  const states = await listAll<PlaneState>(STATES_URL);
  if (BACKFILL) await backfill();
  else await sync(states);
}

await main();
