import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { configureLogging, flushLogs, logEvent } = await import("./logging.ts");
const { DEFAULT_SLOW_REQUEST_MS, resolveSlowRequestMs, withRequestLog } = await import(
  "./api-request-log.ts"
);

function createLogDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-request-log-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function readRecords(dir) {
  const records = [];
  for (const name of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, name), "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) records.push(JSON.parse(line));
    }
  }
  return records;
}

async function useTempTransport(t) {
  const dir = createLogDir(t);
  await configureLogging({ file: dir, stdout: false, env: { NODE_ENV: "production" } });
  return dir;
}

function makeRequest(headers = {}) {
  return new Request("http://localhost:30141/api/sessions?force=1", {
    headers: { host: "localhost:30141", ...headers },
  });
}

function completionRecord(records) {
  const record = records.find((entry) => entry.message === "http.request");
  assert.ok(record, `expected an http.request record, got ${JSON.stringify(records)}`);
  return record;
}

test("logs one completion record and runs the handler inside the request context", async (t) => {
  const dir = await useTempTransport(t);
  const before = new Response("unchanged", {
    status: 200,
    headers: { "X-From-Handler": "yes" },
  });
  const wrapped = withRequestLog("/api/sessions", async (request) => {
    logEvent("info", "http", "handler.inside", { url: request.url });
    return before;
  });

  const response = await wrapped(makeRequest({
    "x-ompdesk-request-id": "req-fixed",
    "x-ompdesk-actor": "password",
  }));
  flushLogs();

  assert.equal(response, before, "the wrapper must return the handler's response object");
  assert.equal(await response.text(), "unchanged");
  assert.equal(response.headers.get("x-from-handler"), "yes");

  const records = readRecords(dir);
  const record = completionRecord(records);
  assert.equal(record.requestId, "req-fixed");
  assert.equal(record.route, "/api/sessions");
  assert.equal(record.method, "GET");
  assert.equal(record.status, 200);
  assert.equal(record.slow, false);
  assert.equal(record.actor, "password");
  assert.equal(record.subsystem, "http");
  assert.equal(record.source, "ompdesk");
  assert.equal(record.level, "info");
  assert.equal(typeof record.durationMs, "number");
  assert.ok(record.durationMs >= 0);

  const nested = records.find((entry) => entry.message === "handler.inside");
  assert.ok(nested, "nested logEvent must reach the same file");
  assert.equal(nested.requestId, "req-fixed");
  assert.equal(nested.route, "/api/sessions");
  assert.equal(nested.actor, "password");
});

test("generates a request id when the proxy did not provide one", async (t) => {
  const dir = await useTempTransport(t);
  const wrapped = withRequestLog("/api/sessions", () => Response.json({ ok: true }));

  await wrapped(makeRequest());
  flushLogs();

  const record = completionRecord(readRecords(dir));
  assert.match(record.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(record.actor, undefined);
});

test("passes handler arguments and the response through untouched", async (t) => {
  await useTempTransport(t);
  const params = Promise.resolve({ id: "session-1" });
  let received;
  const response = Response.json({ id: "session-1" }, { status: 201, headers: { "Cache-Control": "no-store" } });
  const wrapped = withRequestLog("/api/sessions/[id]", async (request, context) => {
    received = { url: request.url, params: await context.params };
    return response;
  });

  const returned = await wrapped(makeRequest(), { params });
  assert.equal(returned, response);
  assert.equal(returned.status, 201);
  assert.equal(returned.headers.get("cache-control"), "no-store");
  assert.deepEqual(received, {
    url: "http://localhost:30141/api/sessions?force=1",
    params: { id: "session-1" },
  });
});

test("records a 404 without changing it", async (t) => {
  const dir = await useTempTransport(t);
  const wrapped = withRequestLog("/api/sessions/[id]", () =>
    Response.json({ error: "Not found" }, { status: 404, headers: { "X-Reason": "missing" } }));

  const response = await wrapped(makeRequest({ "x-ompdesk-request-id": "req-404" }));
  flushLogs();

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("x-reason"), "missing");
  assert.deepEqual(await response.json(), { error: "Not found" });

  const record = completionRecord(readRecords(dir));
  assert.equal(record.status, 404);
  assert.equal(record.requestId, "req-404");
  assert.equal(record.level, "warn");
});

test("records a 500 response without changing it", async (t) => {
  const dir = await useTempTransport(t);
  const wrapped = withRequestLog("/api/sessions", () =>
    Response.json({ error: "failed" }, { status: 500 }));

  const response = await wrapped(makeRequest({ "x-ompdesk-request-id": "req-500" }));
  flushLogs();

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "failed" });

  const record = completionRecord(readRecords(dir));
  assert.equal(record.status, 500);
  assert.equal(record.level, "error");
});

test("logs a thrown handler error with its stack and rethrows the same error", async (t) => {
  const dir = await useTempTransport(t);
  const failure = new Error("handler exploded");
  const wrapped = withRequestLog("/api/sessions", () => {
    throw failure;
  });

  await assert.rejects(
    wrapped(makeRequest({ "x-ompdesk-request-id": "req-throw", "x-ompdesk-actor": "recovery" })),
    (error) => error === failure,
  );
  flushLogs();

  const record = completionRecord(readRecords(dir));
  assert.equal(record.requestId, "req-throw");
  assert.equal(record.actor, "recovery");
  assert.equal(record.status, 500);
  assert.equal(record.level, "error");
  assert.equal(record.failed, true);
  assert.equal(record.error.name, "Error");
  assert.equal(record.error.message, "handler exploded");
  assert.match(record.error.stack, /handler exploded/);
});

test("flags requests that exceed the slow threshold", async (t) => {
  const dir = await useTempTransport(t);
  const previous = process.env.OMPDESK_SLOW_REQUEST_MS;
  process.env.OMPDESK_SLOW_REQUEST_MS = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.OMPDESK_SLOW_REQUEST_MS;
    else process.env.OMPDESK_SLOW_REQUEST_MS = previous;
  });

  const wrapped = withRequestLog("/api/sessions", async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return Response.json({ ok: true });
  });

  await wrapped(makeRequest({ "x-ompdesk-request-id": "req-slow" }));
  flushLogs();

  const record = completionRecord(readRecords(dir));
  assert.equal(record.slow, true);
  assert.ok(record.durationMs >= 10);
});

test("slow threshold defaults to 1000ms and ignores invalid overrides", () => {
  assert.equal(resolveSlowRequestMs({}), DEFAULT_SLOW_REQUEST_MS);
  assert.equal(DEFAULT_SLOW_REQUEST_MS, 1_000);
  assert.equal(resolveSlowRequestMs({ OMPDESK_SLOW_REQUEST_MS: "250" }), 250);
  assert.equal(resolveSlowRequestMs({ OMPDESK_SLOW_REQUEST_MS: "0" }), 1_000);
  assert.equal(resolveSlowRequestMs({ OMPDESK_SLOW_REQUEST_MS: "-5" }), 1_000);
  assert.equal(resolveSlowRequestMs({ OMPDESK_SLOW_REQUEST_MS: "soon" }), 1_000);
});

test("never writes credentials or the query string into the record", async (t) => {
  const dir = await useTempTransport(t);
  const authorization = `Basic ${Buffer.from("omp:hunter2", "utf8").toString("base64")}`;
  const wrapped = withRequestLog("/api/sessions", (request) => {
    assert.equal(request.headers.get("authorization"), authorization);
    return new Response("ok");
  });

  await wrapped(new Request("http://localhost:30141/api/sessions?token=top-secret", {
    headers: {
      host: "localhost:30141",
      authorization,
      cookie: "session=cookie-secret",
      "x-ompdesk-request-id": "req-secret",
      "x-ompdesk-actor": "password",
    },
  }));
  flushLogs();

  const raw = fs.readdirSync(dir)
    .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
    .join("\n");
  assert.equal(raw.includes("hunter2"), false);
  assert.equal(raw.includes("cookie-secret"), false);
  assert.equal(raw.includes("top-secret"), false);
  assert.equal(raw.includes(authorization), false);

  const record = completionRecord(readRecords(dir));
  assert.equal(record.authorization, undefined);
  assert.equal(record.cookie, undefined);
  assert.equal(record.headers, undefined);
});
