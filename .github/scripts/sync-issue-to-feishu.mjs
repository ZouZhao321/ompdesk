import { readFileSync } from "node:fs";

const API = "https://open.feishu.cn/open-apis";
const appId = process.env.FEISHU_APP_ID;
const appSecret = process.env.FEISHU_APP_SECRET;
const baseToken = process.env.FEISHU_BASE_TOKEN;
const tableId = process.env.FEISHU_TABLE_ID;

for (const [name, value] of Object.entries({ appId, appSecret, baseToken, tableId })) {
  if (!value) {
    console.error(`missing ${name}`);
    process.exit(1);
  }
}

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const issue = event.issue;

if (!issue) {
  console.log("event has no issue, nothing to sync");
  process.exit(0);
}

async function feishu(path, init) {
  const response = await fetch(`${API}${path}`, init);
  const payload = await response.json();
  if (payload.code !== 0) {
    console.error(`${init.method} ${path} failed: ${payload.code} ${payload.msg}`);
    process.exit(1);
  }
  return payload.data;
}

const authResponse = await fetch(`${API}/auth/v3/tenant_access_token/internal`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
});
const authPayload = await authResponse.json();
if (authPayload.code !== 0) {
  console.error(`tenant_access_token failed: ${authPayload.code} ${authPayload.msg}`);
  process.exit(1);
}
const authHeader = { Authorization: `Bearer ${authPayload.tenant_access_token}` };

const filter = JSON.stringify({
  logic: "and",
  conditions: [["GitHub 编号", "==", issue.number]],
});
const query = new URLSearchParams({ filter, limit: "1", offset: "0" });
const existing = await feishu(
  `/base/v3/bases/${baseToken}/tables/${tableId}/records?${query.toString()}`,
  { headers: authHeader },
);

const recordId = existing.record_id_list?.[0];
const statusIndex = existing.fields ? existing.fields.indexOf("状态") : -1;
const currentStatus =
  recordId && statusIndex >= 0 ? existing.data?.[0]?.[statusIndex]?.[0] : undefined;

const baseFields = {
  标题: issue.title,
  正文: issue.body ?? "",
  "GitHub 链接": issue.html_url,
};

function closedStatus() {
  return issue.state_reason === "not_planned" ? "不处理" : "已完成";
}

if (!recordId) {
  const fields = {
    ...baseFields,
    来源: ["GitHub 外部"],
    "GitHub 编号": issue.number,
    状态: [issue.state === "closed" ? closedStatus() : "待分类"],
    创建时间: issue.created_at,
  };
  if (issue.closed_at) fields.关闭时间 = issue.closed_at;
  await feishu(`/base/v3/bases/${baseToken}/tables/${tableId}/records/batch_create`, {
    method: "POST",
    headers: { ...authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ create_records: [fields] }),
  });
  console.log(`created record for #${issue.number}`);
  process.exit(0);
}

const fields = { ...baseFields };

if (issue.state === "closed" && currentStatus !== "不处理") {
  fields.状态 = [closedStatus()];
  fields.关闭时间 = issue.closed_at;
}
if (issue.state === "open" && currentStatus === "已完成") {
  fields.状态 = ["待办"];
  fields.关闭时间 = null;
}

await feishu(`/base/v3/bases/${baseToken}/tables/${tableId}/records/batch_update`, {
  method: "POST",
  headers: { ...authHeader, "Content-Type": "application/json" },
  body: JSON.stringify({ update_records: { [recordId]: fields } }),
});
console.log(`updated record for #${issue.number}`);
