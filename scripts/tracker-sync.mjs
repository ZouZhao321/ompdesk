// 内部追踪器同步：开工认领、关联 PR、合并收尾。
// 配置来自环境变量：TRACKER_API_KEY、TRACKER_PROJECT_ID 必填；
// TRACKER_BASE_URL 默认 http://127.0.0.1:8080，TRACKER_WORKSPACE 默认 ompdesk。

const BASE_URL = process.env.TRACKER_BASE_URL ?? "http://127.0.0.1:8080";
const WORKSPACE = process.env.TRACKER_WORKSPACE ?? "ompdesk";
const PROJECT_ID = process.env.TRACKER_PROJECT_ID;
const API_KEY = process.env.TRACKER_API_KEY ?? process.env.PLANE_API_KEY;

if (!PROJECT_ID) throw new Error("TRACKER_PROJECT_ID is not set");
if (!API_KEY) throw new Error("TRACKER_API_KEY is not set");

const API = `${BASE_URL}/api/v1/workspaces/${WORKSPACE}/projects/${PROJECT_ID}`;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = { ref: [], pr: null, assignee: null, dryRun: false };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--ref") flags.ref.push(rest[(i += 1)]);
    else if (arg === "--pr") flags.pr = Number(rest[(i += 1)]);
    else if (arg === "--assignee") flags.assignee = rest[(i += 1)];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return { command, flags };
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "X-Api-Key": API_KEY,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function listAll(path) {
  const results = [];
  let cursor = null;
  for (;;) {
    const sep = path.includes("?") ? "&" : "?";
    const query = `per_page=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const page = await api(`${path}${sep}${query}`);
    results.push(...page.results);
    if (!page.next_page_results) return results;
    cursor = page.next_cursor;
  }
}

function parseSequence(input) {
  const match = /^(?:[A-Z]+-)?#?(\d+)$/i.exec(String(input).trim());
  if (!match) throw new Error(`invalid work item ref: ${input}`);
  return Number(match[1]);
}

async function issues() {
  return listAll("/issues/");
}

async function issueBySequence(sequence) {
  const found = (await issues()).find((issue) => issue.sequence_id === sequence);
  if (!found) throw new Error(`work item ${sequence} not found`);
  return found;
}

async function stateByName(name) {
  const states = await listAll("/states/");
  const found = states.find((state) => state.name.toLowerCase() === name.toLowerCase());
  if (!found) throw new Error(`state not found: ${name}`);
  return found;
}

async function memberByName(name) {
  const members = await api("/members/");
  const list = Array.isArray(members) ? members : members.results;
  const found = list.find(
    (member) =>
      member.id === name ||
      (member.display_name ?? "").toLowerCase() === String(name).toLowerCase(),
  );
  if (!found) throw new Error(`member not found: ${name}`);
  return found;
}

async function linksOf(issueId) {
  return listAll(`/issues/${issueId}/links/`);
}

async function commentsOf(issueId) {
  return listAll(`/issues/${issueId}/comments/`);
}

async function patchIssue(issue, payload) {
  return api(`/issues/${issue.id}/`, { method: "PATCH", body: JSON.stringify(payload) });
}

let repoUrl = null;

function prUrlOf(number) {
  if (repoUrl === null) {
    const result = Bun.spawnSync(["gh", "repo", "view", "--json", "url", "--jq", ".url"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      throw new Error(`gh repo view failed: ${result.stderr.toString().trim()}`);
    }
    repoUrl = result.stdout.toString().trim();
  }
  return `${repoUrl}/pull/${number}`;
}

function prView(number) {
  const result = Bun.spawnSync(
    [
      "gh",
      "pr",
      "view",
      String(number),
      "--json",
      "number,url,state,mergedAt,mergeCommit,title,statusCheckRollup",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) {
    throw new Error(`gh pr view ${number} failed: ${result.stderr.toString().trim()}`);
  }
  return JSON.parse(result.stdout.toString());
}

function checksSummary(pr) {
  const checks = pr.statusCheckRollup ?? [];
  if (checks.length === 0) return "无检查记录";
  const passed = checks.filter((check) => check.conclusion === "SUCCESS").length;
  const failed = checks.filter((check) => check.conclusion === "FAILURE").length;
  return `${checks.length} 项检查，${passed} 项通过，${failed} 项失败`;
}

async function runClaim(flags) {
  const sequence = parseSequence(flags.ref[0]);
  const issue = await issueBySequence(sequence);
  const state = await stateByName("In Progress");
  const assigneeName = flags.assignee ?? process.env.TRACKER_ASSIGNEE;
  const member = assigneeName ? await memberByName(assigneeName) : null;
  const assigned = member ? issue.assignees.includes(member.id) : null;
  if (issue.state === state.id && (member === null || assigned)) {
    console.log(`#${sequence} 已在开发中${member ? `，负责人 ${member.display_name ?? member.id}` : ""}`);
    return;
  }
  if (issue.state === (await stateByName("Done")).id) {
    throw new Error(`#${sequence} 已完成，不能认领`);
  }
  const payload = { state: state.id };
  if (member) payload.assignees = [member.id];
  if (flags.dryRun) {
    console.log(`#${sequence} -> In Progress${member ? `，负责人 ${member.display_name ?? member.id}` : ""}`);
    return;
  }
  await patchIssue(issue, payload);
  console.log(`#${sequence} -> In Progress${member ? `，负责人 ${member.display_name ?? member.id}` : ""}`);
}

async function runLink(flags) {
  if (!flags.pr) throw new Error("--pr is required");
  const sequence = parseSequence(flags.ref[0]);
  const issue = await issueBySequence(sequence);
  const url = prUrlOf(flags.pr);
  const existing = await linksOf(issue.id);
  if (existing.some((link) => link.url === url)) {
    console.log(`#${sequence} 已关联 PR #${flags.pr}`);
    return;
  }
  if (flags.dryRun) {
    console.log(`#${sequence} -> 关联 PR #${flags.pr}`);
    return;
  }
  await api(`/issues/${issue.id}/links/`, {
    method: "POST",
    body: JSON.stringify({ url, title: `PR #${flags.pr}` }),
  });
  console.log(`#${sequence} -> 关联 PR #${flags.pr}`);
}

async function closeIssue(issue, pr, doneState, dryRun) {
  const marker = `PR #${pr.number}`;
  const comments = await commentsOf(issue.id);
  const commented = comments.some((comment) => (comment.comment_html ?? "").includes(marker));
  if (dryRun) {
    console.log(`#${issue.sequence_id} -> Done，追加 ${commented ? "0" : "1"} 条评论`);
    return;
  }
  if (issue.state !== doneState.id) {
    await patchIssue(issue, { state: doneState.id });
  }
  if (!commented) {
    const html =
      `<p>${marker}: <a href="${pr.url}">#${pr.number}</a> 已合并。</p>` +
      `<p>合并提交 <code>${pr.mergeCommit.oid.slice(0, 40)}</code>。CI：${checksSummary(pr)}。</p>`;
    await api(`/issues/${issue.id}/comments/`, {
      method: "POST",
      body: JSON.stringify({ comment_html: html }),
    });
  }
  console.log(`#${issue.sequence_id} -> Done，PR #${pr.number}`);
}

async function runDone(flags) {
  if (!flags.pr) throw new Error("--pr is required");
  if (flags.ref.length === 0) throw new Error("--ref is required");
  const pr = prView(flags.pr);
  if (pr.state !== "MERGED") throw new Error(`PR #${pr.number} is ${pr.state}, not merged`);
  const doneState = await stateByName("Done");
  const targets = [];
  for (const ref of flags.ref) targets.push(await issueBySequence(parseSequence(ref)));
  const seen = new Set();
  for (const issue of targets) {
    if (seen.has(issue.id)) continue;
    seen.add(issue.id);
    await closeIssue(issue, pr, doneState, flags.dryRun);
  }
}

const { command, flags } = parseArgs(process.argv.slice(2));
if (command === "claim") await runClaim(flags);
else if (command === "link") await runLink(flags);
else if (command === "done") await runDone(flags);
else throw new Error("usage: tracker-sync.mjs <claim|link|done> [--ref N] [--pr N] [--assignee name]");
