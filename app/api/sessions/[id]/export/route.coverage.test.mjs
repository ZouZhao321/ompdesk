import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test, { after, beforeEach } from "node:test";
import { createJiti } from "jiti";

/**
 * 会话导出的响应头、文件名分支与失败路径。会话文件与注册表都换到 `.tmp/` 下，
 * 导出沿用产品自己的 omp CLI 调用（与 `export-route.test.mjs` 相同）。
 */
const TASK_DIR = path.join(process.cwd(), ".tmp", "export-coverage");

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./route.ts");

const STATE_KEYS = [
  "__ompSessions",
  "__ompFinalSessionIds",
  "__ompSessionPathCache",
  "__ompPathToSessionIdCache",
  "__ompSessionListCache",
];
const previousState = STATE_KEYS.map((key) => [key, globalThis[key]]);

function writeSession(id, cwd, sessionPath) {
  const timestamp = "2026-08-12T01:02:03.000Z";
  writeFileSync(
    sessionPath,
    [
      { type: "session", version: 3, id, timestamp, cwd },
      { type: "message", id: "u1", parentId: null, timestamp, message: { role: "user", content: `hi ${id}` } },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n",
  );
}

beforeEach(() => {
  rmSync(TASK_DIR, { recursive: true, force: true });
  mkdirSync(TASK_DIR, { recursive: true });
});

after(() => {
  for (const [key, value] of previousState) globalThis[key] = value;
  rmSync(TASK_DIR, { recursive: true, force: true });
});

function requestExport(id, search = "") {
  return GET(
    new Request(`http://localhost/api/sessions/${encodeURIComponent(id)}/export${search}`, {
      headers: { host: "localhost" },
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function assertHtmlResponse(response, { inline, expectedHeader }) {
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "no-cache");
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  const disposition = response.headers.get("Content-Disposition");
  assert.match(disposition, new RegExp(`^${inline ? "inline" : "attachment"};`));
  assert.match(disposition, /filename\*=UTF-8''/);
  assert.match(disposition, new RegExp(expectedHeader));
  assert.match(await response.text(), /<html/i);
}

test("export uses an attachment disposition by default", async () => {
  const id = "export-coverage-plain";
  const sessionPath = path.join(TASK_DIR, `${id}.jsonl`);
  writeSession(id, TASK_DIR, sessionPath);
  globalThis.__ompSessions = new Map();
  globalThis.__ompFinalSessionIds = new Map();
  globalThis.__ompSessionPathCache = new Map([[id, sessionPath]]);
  globalThis.__ompPathToSessionIdCache = new Map([[sessionPath, id]]);
  globalThis.__ompSessionListCache = { data: [], ts: Date.now() };

  await assertHtmlResponse(await requestExport(id), {
    inline: false,
    expectedHeader: `filename="pi-session-${id}\\.html"`,
  });
});

test("export escapes characters encodeURIComponent leaves alone and quotes in the fallback name", async () => {
  const id = "export-coverage-quoted";
  const sessionPath = path.join(TASK_DIR, `we'ird (name);v2.jsonl`);
  writeSession(id, TASK_DIR, sessionPath);
  globalThis.__ompSessions = new Map();
  globalThis.__ompFinalSessionIds = new Map();
  globalThis.__ompSessionPathCache = new Map([[id, sessionPath]]);
  globalThis.__ompPathToSessionIdCache = new Map([[sessionPath, id]]);
  globalThis.__ompSessionListCache = { data: [], ts: Date.now() };

  const response = await requestExport(id, "?inline=1");
  const disposition = response.headers.get("Content-Disposition");

  assert.equal(response.status, 200);
  assert.match(disposition, /^inline;/);
  assert.match(disposition, /filename="pi-session-we'ird \(name\)_v2.html"/);
  assert.match(disposition, /filename\*=UTF-8''pi-session-we%27ird%20%28name%29%3Bv2\.html/);
});

test("export answers 500 when the transcript cannot be rendered", async () => {
  const id = "export-coverage-unreadable";
  const unreadable = path.join(TASK_DIR, "not-a-transcript.jsonl");
  mkdirSync(unreadable, { recursive: true });
  globalThis.__ompSessions = new Map();
  globalThis.__ompFinalSessionIds = new Map();
  globalThis.__ompSessionPathCache = new Map([[id, unreadable]]);
  globalThis.__ompPathToSessionIdCache = new Map([[unreadable, id]]);
  globalThis.__ompSessionListCache = { data: [], ts: Date.now() };

  const response = await requestExport(id);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Unable to export session" });
});
