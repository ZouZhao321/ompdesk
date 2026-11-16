/**
 * 场景：会话导出路由的 GET。
 *
 * 走真实路由模块：先铺一份会话样本并把它所在的 agent 目录切成活动目录，再按路由的调用
 * 形状传入 `Request` 与 `params`。成功路径要求 200 与真实体量的 HTML（≥ 100KB），并要求
 * 导出用的临时产物被清理；失败路径要求不存在的会话 id 得到 404，而不是抛错或挂起。
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.join(import.meta.dir, "..", "..");

/**
 * 路由把导出结果写进系统临时目录，读完即删；清理断言盯的就是这个目录。用例已把
 * `TEMP`/`TMP` 指到场景自己的目录，这台机器上并行的其它进程不会往里写素材。
 */
const EXPORT_TEMP_DIR = path.join(tmpdir(), "ompdesk-export");

/** 回环地址：`isApiRequestAllowed` 只信任本机名、IP 字面量或运维显式放行的主机名。 */
const ALLOWED_HOST = "127.0.0.1:1";

/** 用例：`existing` 导出真实样本，`missing` 请求不存在的会话 id。 */
const CASES = new Set(["existing", "missing"]);

export async function run() {
  const root = process.env.OMPDESK_CONSOLE_SCENARIO_ROOT;
  if (!root) throw new Error("缺少 OMPDESK_CONSOLE_SCENARIO_ROOT");
  const caseName = process.env.OMPDESK_CONSOLE_EXPORT_CASE;
  if (!CASES.has(caseName)) throw new Error(`未知用例 ${String(caseName)}`);

  const runtimeDir = path.join(root, "runtime", "agent");
  const fixtureDir = path.join(root, "agent");
  const projectDir = path.join(root, "project");
  for (const dir of [runtimeDir, fixtureDir, projectDir, path.join(root, "tmp")]) mkdirSync(dir, { recursive: true });

  const { switchAgentDir } = await import(
    pathToFileURL(path.join(REPO_ROOT, "test-support", "agent-dir-sandbox.ts")).href
  );
  const { seedSessions } = await import(
    pathToFileURL(path.join(REPO_ROOT, "test-support", "session-fixtures.ts")).href
  );

  // 铺样本会写活动目录的 history.db，样本目录必须与活动目录分开；铺完再切到样本目录，
  // 路由的会话索引才扫描得到它。
  switchAgentDir(runtimeDir);
  const sessions = await seedSessions("single-turn", { agentDir: fixtureDir, cwd: projectDir });
  const sample = sessions[0];
  if (!sample) throw new Error("会话样本没有铺出来");
  switchAgentDir(fixtureDir);

  const routeUrl = pathToFileURL(path.join(REPO_ROOT, "app", "api", "sessions", "[id]", "export", "route.ts")).href;
  const { GET } = await import(routeUrl);
  const sessionId = caseName === "existing" ? sample.id : `missing-${sample.id}`;

  const artifactsBefore = new Set(listExportArtifacts());
  const response = await GET(
    new Request(`http://${ALLOWED_HOST}/api/sessions/${encodeURIComponent(sessionId)}/export`, {
      headers: { host: ALLOWED_HOST },
    }),
    { params: Promise.resolve({ id: sessionId }) },
  );

  // 临时产物在响应返回前就被清掉：成功与失败两条路径都不留 `.html`。
  const leftover = listExportArtifacts().filter((name) => !artifactsBefore.has(name));
  if (leftover.length > 0) throw new Error(`导出临时产物没有清理：${leftover.join("、")}`);

  if (caseName === "existing") {
    if (response.status !== 200) throw new Error(`存在会话的导出没有成功：${response.status} ${await response.text()}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("text/html")) throw new Error(`导出结果不是 HTML：${contentType}`);
    const disposition = response.headers.get("content-disposition") ?? "";
    if (!disposition.startsWith("attachment")) throw new Error(`导出结果不是附件下载：${disposition}`);
    const body = await response.text();
    if (!body.startsWith("<!DOCTYPE html>")) throw new Error(`导出结果不是 HTML 文档：${body.slice(0, 80)}`);
    // 真实导出把整份会话渲染进 HTML，本机实测约 550KB；1KB 量级的响应体只可能是错误页或
    // 空壳。已知限制：这里无法区分「omp CLI 子进程导出」与「进程内降级导出」，两者都不弹窗，
    // 窗口判定覆盖不到降级分支。
    if (body.length < 100_000) throw new Error(`导出结果不像真实导出：${body.length} 字节`);
  } else {
    if (response.status !== 404)
      throw new Error(`缺失会话的导出没有返回 404：${response.status} ${await response.text()}`);
    const body = await response.json();
    if (body?.error !== "Session not found") throw new Error(`404 响应体不符合预期：${JSON.stringify(body)}`);
  }
}

function listExportArtifacts() {
  return existsSync(EXPORT_TEMP_DIR) ? readdirSync(EXPORT_TEMP_DIR) : [];
}
