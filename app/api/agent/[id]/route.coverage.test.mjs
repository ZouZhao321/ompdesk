import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { createJiti } from "jiti";

/**
 * `POST /api/agent/[id]` 把命令送进已有会话。这里把运行时注册表换成内存里的替身，
 * 不启动任何真实 agent 进程；GET 由 `sessions/runtime-route.test.mjs` 覆盖。
 */
const STATE_KEYS = ["__ompSessions", "__ompFinalSessionIds", "__ompSessionPathCache", "__ompSessionListCache"];
const previousState = STATE_KEYS.map((key) => [key, globalThis[key]]);

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");

beforeEach(() => {
  globalThis.__ompSessions = new Map();
  globalThis.__ompFinalSessionIds = new Map();
  globalThis.__ompSessionPathCache = new Map();
  globalThis.__ompSessionListCache = { data: [], ts: Date.now() };
});

after(() => {
  for (const [key, value] of previousState) globalThis[key] = value;
});

function post(id, body, { headers = { host: "localhost:30141" }, contentType = "application/json" } = {}) {
  const requestHeaders = { ...headers };
  if (contentType !== undefined) requestHeaders["content-type"] = contentType;
  return POST(
    new Request(`http://localhost:30141/api/agent/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: requestHeaders,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function liveSession({ send, sessionId = "live-session", runtimeId = "runtime:live" } = {}) {
  return {
    isAlive: () => true,
    sessionId,
    runtimeId,
    send: send ?? (async () => ({ accepted: true })),
    syncSessionIdentity: () => {},
  };
}

test("POST refuses an untrusted host", async () => {
  const response = await post("live-session", { type: "prompt" }, { headers: { host: "untrusted.invalid" } });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Untrusted API request" });
});

test("POST refuses a non-JSON body", async () => {
  const response = await post("live-session", { type: "prompt" }, { contentType: "text/plain" });
  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), { error: "Content-Type must be application/json" });
});

test("POST forwards the command to a running session and reports its identity", async () => {
  const sent = [];
  const session = liveSession({
    sessionId: "canonical-session",
    runtimeId: "runtime:canonical",
    send: async (body) => {
      sent.push(body);
      return { accepted: true, echoed: body.type };
    },
  });
  globalThis.__ompSessions.set("runtime:canonical", session);

  const response = await post("runtime:canonical", { type: "prompt", message: "hello" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    data: { accepted: true, echoed: "prompt" },
    sessionId: "canonical-session",
    runtimeId: "runtime:canonical",
  });
  assert.deepEqual(sent, [{ type: "prompt", message: "hello" }]);
});

test("POST reports an expired runtime handle with its final session id", async () => {
  globalThis.__ompFinalSessionIds.set("runtime:gone", "final-session-id");

  const response = await post("runtime:gone", { type: "get_state" });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Runtime session expired",
    code: "runtime_expired",
    accepted: false,
    sessionId: "final-session-id",
  });
});

test("POST rejects a prompt for an unknown session and labels it prompt_rejected", async () => {
  const response = await post("missing-session", { type: "prompt", message: "hello" });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Session not found",
    code: "prompt_rejected",
    accepted: false,
  });
});

test("POST rejects a non-prompt command for an unknown session without the prompt code", async () => {
  const response = await post("missing-session", { type: "get_state" });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Session not found" });
});

test("POST surfaces a failing session and still labels the rejected prompt", async () => {
  const session = liveSession({
    sessionId: "failing-session",
    send: async () => {
      throw new Error("agent refused the prompt");
    },
  });
  globalThis.__ompSessions.set("failing-session", session);

  const response = await post("failing-session", { type: "prompt", message: "hello" });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "agent refused the prompt",
    code: "prompt_rejected",
    accepted: false,
  });
});

test("POST surfaces a failing session without the prompt code for other commands", async () => {
  const session = liveSession({
    sessionId: "failing-command",
    runtimeId: "runtime:failing-command",
    send: async () => {
      throw "string failure";
    },
  });
  globalThis.__ompSessions.set("failing-command", session);

  const response = await post("failing-command", { type: "get_state" });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "string failure" });
});
