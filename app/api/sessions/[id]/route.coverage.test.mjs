import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test, { after, beforeEach } from "node:test";
import { createJiti } from "jiti";

/**
 * `/api/sessions/[id]`：GET 的会话详情，PATCH 的改名/归档，DELETE 的级联改挂与删除。
 * 每个用例用 `.tmp/` 下自己的会话目录与归档目录，运行时注册表换成内存替身。
 */
const TASK_DIR = path.join(process.cwd(), ".tmp", "sessions-route-coverage");
const RUN_DIR = path.join(TASK_DIR, `run-${process.pid}`);
const AGENT_DIR = path.join(RUN_DIR, "agent");
/** 清掉上一轮留下的目录：它们的 history.db 句柄已随进程退出释放。 */
try {
  for (const entry of readdirSync(TASK_DIR)) {
    try {
      rmSync(path.join(TASK_DIR, entry), { recursive: true, force: true });
    } catch {
      // 句柄仍在的目录跳过即可，按进程命名的新目录不受影响。
    }
  }
} catch {
  // TASK_DIR 还不存在。
}

const { getAgentDir, setAgentDir } = await import("@oh-my-pi/pi-utils");
const originalAgentDir = getAgentDir();
setAgentDir(AGENT_DIR);

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, PATCH, DELETE } = await jiti.import("./route.ts");

const STATE_KEYS = [
  "__ompSessions",
  "__ompFinalSessionIds",
  "__ompSessionPathCache",
  "__ompPathToSessionIdCache",
  "__ompSessionListCache",
];
const previousState = STATE_KEYS.map((key) => [key, globalThis[key]]);

const HEADERS = { host: "localhost:30141" };

let caseCount = 0;
let sessionDir;

beforeEach(() => {
  caseCount += 1;
  sessionDir = path.join(RUN_DIR, `case-${caseCount}`, "sessions");
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(AGENT_DIR, { recursive: true });
  rmSync(path.join(AGENT_DIR, "ompdesk-archived.json"), { force: true });
  globalThis.__ompSessions = new Map();
  globalThis.__ompFinalSessionIds = new Map();
  globalThis.__ompSessionPathCache = new Map();
  globalThis.__ompPathToSessionIdCache = new Map();
  globalThis.__ompSessionListCache = { data: [], ts: Date.now() };
});

after(() => {
  for (const [key, value] of previousState) globalThis[key] = value;
  setAgentDir(originalAgentDir);
  // SDK 的 history.db 句柄活到进程结束，Windows 上删不掉 agent 目录本身；
  // 用例的会话文件与归档注册表都清掉，只剩 `.tmp/` 里这一份被占用的临时目录。
  for (const entry of readdirSync(RUN_DIR)) {
    if (entry === "agent") continue;
    rmSync(path.join(RUN_DIR, entry), { recursive: true, force: true });
  }
  for (const target of [AGENT_DIR, RUN_DIR]) {
    try {
      rmSync(target, { recursive: true, force: true });
    } catch {
      // history.db 仍被本进程占用；下一轮运行开头会清掉上一轮的目录。
    }
  }
});

function sessionFile(id, { parentSession, name } = {}) {
  const filePath = path.join(sessionDir, `${id}.jsonl`);
  const header = {
    type: "session",
    version: 3,
    id,
    timestamp: "2026-08-12T01:02:03.000Z",
    cwd: sessionDir,
    ...(parentSession ? { parentSession } : {}),
  };
  const lines = [
    JSON.stringify(header),
    JSON.stringify({
      type: "message",
      id: "u1",
      parentId: null,
      timestamp: "2026-08-12T01:02:04.000Z",
      message: { role: "user", content: name ?? `hello ${id}` },
    }),
  ];
  writeFileSync(filePath, `${lines.join("\n")}\n`);
  return filePath;
}

function cachePath(id, filePath) {
  globalThis.__ompSessionPathCache.set(id, filePath);
  globalThis.__ompPathToSessionIdCache.set(path.normalize(filePath), id);
}

function readEntries(filePath) {
  return readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function liveSession(id, { entries, model, sessionName, getEntries } = {}) {
  const timestamp = "2026-08-12T01:02:03.000Z";
  const sessionManager = {
    getHeader: () => ({ type: "session", id, cwd: sessionDir, timestamp }),
    getEntries: getEntries ?? (() => entries),
    getLeafId: () => entries?.[entries.length - 1]?.id ?? null,
    getTree: () => [],
    getSessionName: () => sessionName,
    getSessionFile: () => path.join(sessionDir, `${id}.jsonl`),
  };
  return {
    isAlive: () => true,
    sessionId: id,
    runtimeId: `runtime:${id}`,
    sessionFile: sessionManager.getSessionFile(),
    syncSessionIdentity: () => {},
    inner: { sessionManager, ...(model ? { model } : {}) },
  };
}

function getRequest(id, { headers = HEADERS, search = "" } = {}) {
  return GET(new Request(`http://localhost:30141/api/sessions/${encodeURIComponent(id)}${search}`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

function patchRequest(id, body, { headers = HEADERS, contentType = "application/json" } = {}) {
  const requestHeaders = { ...headers };
  if (contentType !== undefined) requestHeaders["content-type"] = contentType;
  return PATCH(
    new Request(`http://localhost:30141/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: requestHeaders,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function deleteRequest(id, { headers = HEADERS } = {}) {
  return DELETE(
    new Request(`http://localhost:30141/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE", headers }),
    { params: Promise.resolve({ id }) },
  );
}

function archivedIds() {
  const file = path.join(AGENT_DIR, "ompdesk-archived.json");
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf8")).archived;
}

test("GET refuses an untrusted host", async () => {
  const response = await getRequest("any", { headers: { host: "untrusted.invalid" } });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Untrusted API request" });
});

test("GET answers 404 for a session that is neither live nor persisted", async () => {
  const response = await getRequest("missing-session");
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Session not found" });
});

test("GET describes a live session, using the runtime model and text blocks of the first turn", async () => {
  const id = "live-get-session";
  const entry = {
    type: "message",
    id: "u1",
    parentId: null,
    timestamp: "2026-08-12T01:02:04.000Z",
    message: {
      role: "user",
      content: [
        { type: "thinking", thinking: "hidden" },
        { type: "text", text: "first visible turn" },
      ],
    },
  };
  sessionFile(id);
  globalThis.__ompSessions.set(id, liveSession(id, { entries: [entry], model: { provider: "prov", id: "model-1" } }));

  const response = await getRequest(id, { search: "?deferThinking&deferMedia" });
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.sessionId, id);
  assert.equal(body.runtimeId, `runtime:${id}`);
  assert.equal(body.leafId, "u1");
  assert.equal(body.info.firstMessage, "first visible turn");
  assert.equal(body.info.id, id);
  assert.equal(body.info.transient, false);
  assert.deepEqual(body.context.model, { provider: "prov", modelId: "model-1" });
});

test("GET reports 500 when the session manager cannot produce entries", async () => {
  const id = "broken-live-session";
  globalThis.__ompSessions.set(
    id,
    liveSession(id, {
      getEntries: () => {
        throw new Error("session manager exploded");
      },
    }),
  );

  const response = await getRequest(id);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.match(body.error, /session manager exploded/);
});

test("PATCH refuses an untrusted host", async () => {
  const response = await patchRequest("any", { name: "x" }, { headers: { host: "untrusted.invalid" } });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Untrusted API request" });
});

test("PATCH refuses a non-JSON body", async () => {
  const response = await patchRequest("any", { name: "x" }, { contentType: "text/plain" });
  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), { error: "Content-Type must be application/json" });
});

test("PATCH requires a name or an archived flag", async () => {
  const response = await patchRequest("any", {});
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "name or archived is required" });
});

test("PATCH answers 404 when the session file cannot be resolved", async () => {
  const response = await patchRequest("missing-session", { name: "Renamed", archived: true });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Session not found" });
});

test("PATCH renames the session and trims the name", async () => {
  const id = "rename-me";
  const filePath = sessionFile(id);
  cachePath(id, filePath);

  const response = await patchRequest(id, { name: "  Renamed session  " });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const title = readEntries(filePath).find((entry) => entry.type === "title");
  assert.equal(title.title, "Renamed session");
});

test("PATCH archives by the header id, not the alias used to reach the session", async () => {
  const id = "archive-me";
  const filePath = sessionFile("archive-me-header");
  cachePath(id, filePath);

  const response = await patchRequest(id, { archived: true });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(archivedIds(), ["archive-me-header"]);

  const restored = await patchRequest(id, { archived: false });
  assert.equal(restored.status, 200);
  assert.deepEqual(archivedIds(), []);
});

test("PATCH can rename and archive in one request", async () => {
  const id = "rename-and-archive";
  const filePath = sessionFile(id);
  cachePath(id, filePath);

  const response = await patchRequest(id, { name: "Both", archived: true });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(archivedIds(), [id]);
  assert.equal(readEntries(filePath).find((entry) => entry.type === "title").title, "Both");
});

test("PATCH reports 500 when the session file cannot be opened for renaming", async () => {
  const id = "corrupt-session";
  const filePath = path.join(sessionDir, `${id}.jsonl`);
  writeFileSync(filePath, "this is not a session header\n");
  cachePath(id, filePath);

  const response = await patchRequest(id, { name: "Renamed" });
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.match(body.error, /malformed/);
});

test("DELETE refuses an untrusted host", async () => {
  const response = await deleteRequest("any", { headers: { host: "untrusted.invalid" } });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Untrusted API request" });
});

test("DELETE answers 404 when the session file cannot be resolved", async () => {
  const response = await deleteRequest("missing-session");
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Session not found" });
});

test("DELETE re-attaches direct children to the deleted session's parent and shuts the runtime down", async () => {
  const parentFile = sessionFile("grandparent");
  const targetId = "delete-target";
  const targetFile = sessionFile(targetId, { parentSession: parentFile });
  const childFile = sessionFile("child", { parentSession: targetFile });
  const unrelatedFile = sessionFile("unrelated", { parentSession: parentFile });
  writeFileSync(path.join(sessionDir, "malformed.jsonl"), "not json\n");
  writeFileSync(path.join(sessionDir, "notes.txt"), "ignored");
  cachePath(targetId, targetFile);

  let shutdowns = 0;
  globalThis.__ompSessions.set(targetId, {
    isAlive: () => true,
    sessionId: targetId,
    runtimeId: "runtime:delete-target",
    syncSessionIdentity: () => {},
    shutdown: async () => {
      shutdowns += 1;
    },
  });

  const response = await deleteRequest(targetId);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(shutdowns, 1, "the live runtime is shut down before the file is removed");
  assert.equal(existsSync(targetFile), false, "the session file is removed");

  assert.equal(readEntries(childFile)[0].parentSession, parentFile, "the child is re-attached to the grandparent");
  assert.equal(readEntries(unrelatedFile)[0].parentSession, parentFile, "sessions with another parent are untouched");
});

test("DELETE reports 500 when the session file cannot be read", async () => {
  const id = "unreadable-session";
  const directory = path.join(sessionDir, `${id}.jsonl`);
  mkdirSync(directory, { recursive: true });
  cachePath(id, directory);

  const response = await deleteRequest(id);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(typeof body.error, "string");
});
