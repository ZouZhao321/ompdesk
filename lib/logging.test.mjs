import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const {
  configureLogging,
  flushLogs,
  isSensitiveLogKey,
  logEvent,
  runWithLogContext,
  sanitizeLogContext,
  shouldMirrorStdout,
} = await import("./logging.ts");

function createLogDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-logging-"));
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

test("writes ompdesk records through the SDK logger with provenance", async (t) => {
  const dir = await useTempTransport(t);

  logEvent("info", "process", "process.start", { version: "1.2.3", pid: 4242, source: "spoofed", subsystem: "spoofed" });
  flushLogs();

  const records = readRecords(dir);
  assert.equal(records.length, 1);
  assert.equal(records[0].message, "process.start");
  assert.equal(records[0].source, "ompdesk");
  assert.equal(records[0].subsystem, "process");
  assert.equal(records[0].level, "info");
  assert.equal(records[0].version, "1.2.3");
  assert.equal(records[0].pid, 4242);
  assert.ok(fs.readdirSync(dir).some((name) => /^omp\.\d{4}-\d{2}-\d{2}\.\d+\.log$/.test(name)));
});

test("drops passwords, tokens, cookies, authorization, and recovery codes", async (t) => {
  const dir = await useTempTransport(t);

  logEvent("warn", "security", "security.auth.denied", {
    password: "hunter2",
    apiKey: "sk-live-secret",
    nested: {
      token: "tok-value",
      authorization: "Bearer abc",
      cookie: "session=1",
      recoveryCode: "ABCD-EFGH",
      headers: { "x-api-key": "nested-key", accept: "json" },
      keep: "visible",
    },
    actor: "password",
  });
  flushLogs();

  const [record] = readRecords(dir);
  assert.equal(record.actor, "password");
  assert.equal(record.password, undefined);
  assert.equal(record.apiKey, undefined);
  assert.equal(record.nested.token, undefined);
  assert.equal(record.nested.authorization, undefined);
  assert.equal(record.nested.cookie, undefined);
  assert.equal(record.nested.recoveryCode, undefined);
  assert.equal(record.nested.headers["x-api-key"], undefined);
  assert.equal(record.nested.headers.accept, "json");
  assert.equal(record.nested.keep, "visible");

  const raw = fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), "utf8");
  for (const secret of ["hunter2", "sk-live-secret", "tok-value", "Bearer abc", "session=1", "ABCD-EFGH"]) {
    assert.equal(raw.includes(secret), false, secret);
  }
});

test("classifies credential-shaped keys on camelCase and separators", () => {
  for (const key of [
    "password", "PASSWORD", "apiKey", "api_key", "x-api-key",
    "refreshToken", "accessToken", "bearerToken", "authToken", "sessionToken", "apiToken",
    "x-api-token", "token", "tokens", "Cookie", "recoveryCode", "privateKey", "Authorization",
  ]) {
    assert.equal(isSensitiveLogKey(key), true, key);
  }
  for (const key of [
    "requestId", "sessionId", "route", "model", "provider", "durationMs",
    "inputTokens", "outputTokens", "cachedTokens", "tokenCount", "tokensBefore", "tokensAfter", "tokensUsed", "inputTokenCount", "token-count",
  ]) {
    assert.equal(isSensitiveLogKey(key), false, key);
  }
});

test("keeps token usage counters in written records", async (t) => {
  const dir = await useTempTransport(t);

  logEvent("info", "agent", "agent.run.end", {
    tokenCount: 1234,
    inputTokens: 900,
    outputTokens: 334,
    cachedTokens: 120,
    tokensBefore: 8000,
    tokensAfter: 9200,
    token: "must-drop",
  });
  flushLogs();

  const [record] = readRecords(dir);
  assert.equal(record.tokenCount, 1234);
  assert.equal(record.inputTokens, 900);
  assert.equal(record.outputTokens, 334);
  assert.equal(record.cachedTokens, 120);
  assert.equal(record.tokensBefore, 8000);
  assert.equal(record.tokensAfter, 9200);
  assert.equal(record.token, undefined);
});

test("truncates long strings, stacks, deep objects, and large arrays", async (t) => {
  const dir = await useTempTransport(t);
  const error = new Error("boom");
  error.stack = `Error: boom\n${"    at frame\n".repeat(1_000)}`;

  logEvent("error", "agent", "agent.run.error", {
    detail: "x".repeat(5_000),
    deep: { level1: { level2: { level3: { level4: { value: "secret" } } } } },
    huge: Array.from({ length: 120 }, (_, index) => index),
    error,
  });
  flushLogs();

  const [record] = readRecords(dir);
  assert.ok(record.detail.length < 5_000);
  assert.match(record.detail, /\[truncated \d+ chars\]/);
  assert.equal(record.deep.level1.level2.level3, "[object]");
  assert.equal(record.huge.length, 51);
  assert.equal(record.huge[50], "[+70 more]");
  assert.equal(record.error.name, "Error");
  assert.equal(record.error.message, "boom");
  assert.ok(record.error.stack.length < 4_200);
  assert.match(record.error.stack, /\[truncated \d+ chars\]/);
});

test("sanitizes circular values and binary content", async (t) => {
  const dir = await useTempTransport(t);
  const circular = { name: "loop" };
  circular.self = circular;

  logEvent("debug", "system", "system.probe", {
    circular,
    bytes: Buffer.from("file contents that must not be logged"),
  });
  flushLogs();

  const [record] = readRecords(dir);
  assert.equal(record.circular.self, "[circular]");
  assert.match(record.bytes, /^\[buffer \d+ bytes\]$/);
});

test("merges async request context into nested records", async (t) => {
  const dir = await useTempTransport(t);

  await runWithLogContext({ requestId: "req-1", sessionId: "sess-1" }, async () => {
    await Promise.resolve();
    logEvent("info", "http", "http.request", { route: "/api/sessions", method: "GET" });
  });
  flushLogs();

  const [record] = readRecords(dir);
  assert.equal(record.requestId, "req-1");
  assert.equal(record.sessionId, "sess-1");
  assert.equal(record.route, "/api/sessions");
  assert.equal(record.source, "ompdesk");
  assert.equal(record.subsystem, "http");
});

test("does not throw when the log destination is unusable", async (t) => {
  const root = createLogDir(t);
  const blocked = path.join(root, "not-a-directory");
  fs.writeFileSync(blocked, "occupied");

  await configureLogging({ file: blocked, stdout: false, env: { NODE_ENV: "production" } });
  assert.doesNotThrow(() => {
    logEvent("error", "system", "system.write_failed", { message: "still fine" });
    flushLogs();
  });
  assert.equal(sanitizeLogContext(undefined).source, undefined);
});

test("respects OMP_LOG_LEVEL on the shared file transport", async (t) => {
  const dir = createLogDir(t);
  const previous = process.env.OMP_LOG_LEVEL;
  process.env.OMP_LOG_LEVEL = "error";
  try {
    await configureLogging({ file: dir, stdout: false, env: { NODE_ENV: "production" } });
    logEvent("debug", "system", "level.debug");
    logEvent("info", "system", "level.info");
    logEvent("warn", "system", "level.warn");
    logEvent("error", "system", "level.error");
    flushLogs();

    assert.deepEqual(readRecords(dir).map((record) => record.message), ["level.error"]);
  } finally {
    if (previous === undefined) delete process.env.OMP_LOG_LEVEL;
    else process.env.OMP_LOG_LEVEL = previous;
    await configureLogging({ file: dir, stdout: false, env: { NODE_ENV: "production" } });
  }
});

test("stdout mirroring follows the environment override", () => {
  assert.equal(shouldMirrorStdout({ NODE_ENV: "development" }), true);
  assert.equal(shouldMirrorStdout({ NODE_ENV: "production" }), false);
  assert.equal(shouldMirrorStdout({ NODE_ENV: "production", OMPDESK_LOG_STDOUT: "1" }), true);
  assert.equal(shouldMirrorStdout({ NODE_ENV: "development", OMPDESK_LOG_STDOUT: "0" }), false);
  assert.equal(shouldMirrorStdout({ NODE_ENV: "production", OMPDESK_LOG_STDOUT: "yes" }), true);
  assert.equal(shouldMirrorStdout({ NODE_ENV: "development", OMPDESK_LOG_STDOUT: "off" }), false);
  assert.equal(shouldMirrorStdout({ NODE_ENV: "development", OMPDESK_LOG_STDOUT: "maybe" }), true);
});
