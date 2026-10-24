import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { configureLogging, flushLogs } = await import("./logging.ts");
const {
  ClientLogValidationError,
  CLIENT_ERROR_GLOBAL_RATE_LIMIT,
  CLIENT_ERROR_RATE_LIMIT,
  CLIENT_ERROR_RATE_WINDOW_MS,
  CLIENT_LOG_MAX_BODY_BYTES,
  createClientLogHandler,
  parseClientErrorReport,
  recordClientError,
} = await import("./client-logs.ts");
const { SlidingWindowLimiter } = await import("./client-error-report.ts");
const route = await import("../app/api/client-logs/route.ts");

function createLogDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-client-logs-"));
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

function clientErrorRecords(dir) {
  return readRecords(dir).filter((record) => record.message === "client.error");
}

function makeRequest(body, headers = {}) {
  return new Request("http://localhost:30141/api/client-logs", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      "content-type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function validPayload(overrides = {}) {
  return {
    kind: "error",
    message: "boom",
    stack: "Error: boom\n    at ChatWindow (chat.tsx:10:4)",
    url: "/chat?session=sess-1",
    sessionId: "sess-1",
    buildVersion: "1.2.3",
    ...overrides,
  };
}

test("accepts a valid report and writes one client.error record", async (t) => {
  const dir = await useTempTransport(t);
  const handler = createClientLogHandler();

  const response = await handler(makeRequest(validPayload()));

  assert.equal(response.status, 204);
  flushLogs();

  const records = clientErrorRecords(dir);
  assert.equal(records.length, 1);
  const [record] = records;
  assert.equal(record.source, "ompdesk");
  assert.equal(record.subsystem, "client");
  assert.equal(record.level, "error");
  assert.equal(record.kind, "error");
  assert.equal(record.url, "/chat");
  assert.equal(record.sessionId, "sess-1");
  assert.equal(record.buildVersion, "1.2.3");
  assert.equal(record.error.message, "boom");
  assert.match(record.error.stack, /chat\.tsx:10:4/);

  const raw = fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), "utf8");
  assert.equal(raw.includes("session=sess-1"), false, "query strings never reach the log");
});

test("rejects prompts, arbitrary objects, and unknown fields", async (t) => {
  const dir = await useTempTransport(t);
  const handler = createClientLogHandler();

  for (const payload of [
    validPayload({ prompt: "secret prompt" }),
    validPayload({ context: { messages: ["hi"] } }),
    validPayload({ token: "sk-live" }),
    { kind: "prompt", message: "boom" },
    { kind: "error", message: 42 },
    { kind: "error" },
    ["not", "an", "object"],
  ]) {
    const response = await handler(makeRequest(payload));
    assert.equal(response.status, 400, JSON.stringify(payload));
    const body = await response.json();
    assert.equal(typeof body.error, "string");
  }
  flushLogs();
  assert.equal(clientErrorRecords(dir).length, 0);
});

test("rejects a body over the size cap with 413", async (t) => {
  await useTempTransport(t);
  const handler = createClientLogHandler();

  const oversized = await handler(makeRequest({
    kind: "error",
    message: "x".repeat(CLIENT_LOG_MAX_BODY_BYTES),
  }));
  assert.equal(oversized.status, 413);

  const declared = await handler(makeRequest({ kind: "error", message: "small" }, {
    "content-length": String(CLIENT_LOG_MAX_BODY_BYTES + 1),
  }));
  assert.equal(declared.status, 413);

  // Chunked uploads have no trustworthy Content-Length; the reader must cut
  // them off once the wire bytes cross the cap.
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"kind":"error","message":"'));
      controller.enqueue(new TextEncoder().encode("x".repeat(CLIENT_LOG_MAX_BODY_BYTES)));
      controller.close();
    },
  });
  const chunked = await handler(new Request("http://localhost:30141/api/client-logs", {
    method: "POST",
    headers: { host: "localhost:30141", "content-type": "application/json" },
    body: stream,
    duplex: "half",
  }));
  assert.equal(chunked.status, 413);
});

test("rejects malformed JSON and non-JSON content types", async (t) => {
  await useTempTransport(t);
  const handler = createClientLogHandler();

  const malformed = await handler(makeRequest("{not json"));
  assert.equal(malformed.status, 400);

  const wrongType = await handler(makeRequest(validPayload(), { "content-type": "text/plain" }));
  assert.equal(wrongType.status, 415);

  const missingBody = await handler(new Request("http://localhost:30141/api/client-logs", {
    method: "POST",
    headers: { host: "localhost:30141", "content-type": "application/json" },
  }));
  assert.equal(missingBody.status, 400);
});

test("rate limits reports per session and returns Retry-After", async (t) => {
  const dir = await useTempTransport(t);
  const handler = createClientLogHandler({
    limiter: new SlidingWindowLimiter(2, CLIENT_ERROR_RATE_WINDOW_MS),
    globalLimiter: new SlidingWindowLimiter(CLIENT_ERROR_GLOBAL_RATE_LIMIT, CLIENT_ERROR_RATE_WINDOW_MS),
    now: () => 1_000,
  });

  const statuses = [];
  for (const message of ["one", "two", "three"]) {
    const response = await handler(makeRequest(validPayload({ message })));
    statuses.push(response.status);
    if (response.status === 429) {
      assert.equal(response.headers.get("retry-after"), "60");
    }
  }
  assert.deepEqual(statuses, [204, 204, 429]);

  const otherSession = await handler(makeRequest(validPayload({
    message: "other",
    sessionId: "sess-2",
  })));
  assert.equal(otherSession.status, 204);

  flushLogs();
  assert.equal(clientErrorRecords(dir).length, 3);
});

test("applies the global rate limit across sessions", async (t) => {
  await useTempTransport(t);
  const handler = createClientLogHandler({
    limiter: new SlidingWindowLimiter(CLIENT_ERROR_RATE_LIMIT, CLIENT_ERROR_RATE_WINDOW_MS),
    globalLimiter: new SlidingWindowLimiter(2, CLIENT_ERROR_RATE_WINDOW_MS),
    now: () => 5_000,
  });

  assert.equal((await handler(makeRequest(validPayload({ sessionId: "a" })))).status, 204);
  assert.equal((await handler(makeRequest(validPayload({ sessionId: "b" })))).status, 204);
  const limited = await handler(makeRequest(validPayload({ sessionId: "c" })));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
});

test("truncates a long message and stack before writing", async (t) => {
  const dir = await useTempTransport(t);
  const handler = createClientLogHandler();

  const response = await handler(makeRequest(validPayload({
    message: "m".repeat(1_500),
    stack: `Error: ${"s".repeat(2_500)}`,
  })));
  assert.equal(response.status, 204);
  flushLogs();

  const [record] = clientErrorRecords(dir);
  assert.match(record.error.message, /… \[truncated \d+ chars\]$/);
  assert.match(record.error.stack, /… \[truncated \d+ chars\]$/);
  assert.ok(record.error.message.length < 1_100);
  assert.ok(record.error.stack.length < 2_100);
});

test("keeps only the path from a reported url", async (t) => {
  const dir = await useTempTransport(t);
  const handler = createClientLogHandler();

  await handler(makeRequest(validPayload({ url: "https://user:pass@host.test/chat?token=top-secret#x" })));
  flushLogs();

  const [record] = clientErrorRecords(dir);
  assert.equal(record.url, "/chat");
  const raw = fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), "utf8");
  assert.equal(raw.includes("top-secret"), false);
});

test("parseClientErrorReport rejects a non-object body with a status", () => {
  assert.throws(
    () => parseClientErrorReport(null),
    (error) => error instanceof ClientLogValidationError && error.status === 400,
  );
  const parsed = parseClientErrorReport(validPayload());
  assert.equal(parsed.message, "boom");
  assert.equal(parsed.url, "/chat");
});

test("recordClientError writes the stable event name and subsystem", async (t) => {
  const dir = await useTempTransport(t);

  recordClientError({ kind: "unhandledrejection", message: "rejected", sessionId: "sess-9" });
  flushLogs();

  const [record] = clientErrorRecords(dir);
  assert.equal(record.message, "client.error");
  assert.equal(record.subsystem, "client");
  assert.equal(record.kind, "unhandledrejection");
  assert.equal(record.sessionId, "sess-9");
  assert.equal(record.error.message, "rejected");
});

test("the exported route accepts a valid browser report", async (t) => {
  const dir = await useTempTransport(t);

  const response = await route.POST(makeRequest(validPayload({ message: "from the browser" })));
  assert.equal(response.status, 204);
  flushLogs();

  const [record] = clientErrorRecords(dir);
  assert.equal(record.error.message, "from the browser");
  const requestRecord = readRecords(dir).find((entry) => entry.message === "http.request");
  assert.equal(requestRecord.route, "/api/client-logs");
  assert.equal(requestRecord.method, "POST");
  assert.equal(requestRecord.status, 204);
});
