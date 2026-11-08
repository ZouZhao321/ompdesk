import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const { proxy } = await import("../proxy.ts");
const { NextRequest } = await import("next/server");
const { POST: recoveryPost } = await import("../app/api/web-access/recovery/route.ts");
const { configureLogging, flushLogs } = await import("./logging.ts");

const require = createRequire(import.meta.url);
const store = require("../bin/web-auth-store.js");

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createLogDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-security-log-"));
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

function readRawLog(dir) {
  return fs.readdirSync(dir)
    .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
    .join("\n");
}

async function useTempTransport(t) {
  const dir = createLogDir(t);
  await configureLogging({ file: dir, stdout: false, env: { NODE_ENV: "production" } });
  return dir;
}

function securityRecord(dir, message) {
  const records = readRecords(dir);
  const record = records.find((entry) => entry.message === message);
  assert.ok(record, `expected a ${message} record, got ${JSON.stringify(records)}`);
  assert.equal(record.subsystem, "security");
  assert.equal(record.source, "ompdesk");
  return record;
}

function makeRequest(pathname, headers = {}) {
  return new NextRequest(`http://localhost:30141${pathname}`, {
    headers: { host: "localhost:30141", ...headers },
  });
}

function basicAuthorization(password) {
  return `Basic ${Buffer.from(`omp:${password}`, "utf8").toString("base64")}`;
}

async function withEnvironment(vars, run) {
  const previous = new Map();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function missingAuthFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-security-auth-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "ompdesk-auth.json");
}

test("logs an untrusted host denial with the request correlation fields", async (t) => {
  const dir = await useTempTransport(t);
  await withEnvironment({ OMPDESK_PASSWORD: undefined, OMPDESK_AUTH_FILE: missingAuthFile(t) }, async () => {
    for (const [pathname, method] of [["/", "GET"], ["/api/sessions", "GET"]]) {
      const response = proxy(makeRequest(pathname, { host: "attacker.example" }));
      assert.equal(response.status, 403, pathname);
    }
  });
  flushLogs();

  const records = readRecords(dir).filter((entry) => entry.message === "security.host.denied");
  assert.equal(records.length, 2);
  const [page, api] = records;
  assert.equal(page.level, "warn");
  assert.equal(page.reason, "untrusted-host");
  assert.equal(page.route, "/");
  assert.equal(page.method, "GET");
  assert.match(page.requestId, UUID_V4);
  assert.equal(api.route, "/api/sessions");
  assert.equal(api.method, "GET");
  assert.match(api.requestId, UUID_V4);
  assert.equal(readRawLog(dir).includes("Basic "), false);
});

test("logs a cross-site API request denial without changing the response", async (t) => {
  const dir = await useTempTransport(t);
  await withEnvironment({ OMPDESK_PASSWORD: undefined, OMPDESK_AUTH_FILE: missingAuthFile(t) }, async () => {
    const response = proxy(makeRequest("/api/sessions", {
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    }));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    assert.deepEqual(await response.json(), { error: "Untrusted API request" });
  });
  flushLogs();

  const record = securityRecord(dir, "security.origin.denied");
  assert.equal(record.level, "warn");
  assert.equal(record.reason, "cross-site-request");
  assert.equal(record.route, "/api/sessions");
  assert.equal(record.method, "GET");
  assert.match(record.requestId, UUID_V4);
});

test("logs a wrong password as an unauthorized denial and never writes the credential", async (t) => {
  const dir = await useTempTransport(t);
  const password = "correct-horse-battery";
  const wrongPassword = "wrong-horse-battery";
  let authorizationValue;
  await withEnvironment({
    OMPDESK_PASSWORD: password,
    OMPDESK_AUTH_FILE: missingAuthFile(t),
  }, async () => {
    authorizationValue = basicAuthorization(wrongPassword);
    const response = proxy(makeRequest("/api/sessions", { authorization: authorizationValue }));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), 'Basic realm="ompdesk", charset="UTF-8"');
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(await response.json(), {
      error: "Authentication required",
      recoveryPath: "/recover",
    });
  });
  flushLogs();

  const record = securityRecord(dir, "security.auth.denied");
  assert.equal(record.level, "warn");
  assert.equal(record.reason, "invalid-credentials");
  assert.equal(record.route, "/api/sessions");
  assert.equal(record.method, "GET");
  assert.match(record.requestId, UUID_V4);

  const raw = readRawLog(dir);
  for (const secret of [password, wrongPassword, authorizationValue]) {
    assert.equal(raw.includes(secret), false, secret);
  }
});

test("logs an unreadable credential file as an unavailable denial", async (t) => {
  const dir = await useTempTransport(t);
  const authFile = missingAuthFile(t);
  fs.writeFileSync(authFile, "{ this is not json", "utf8");
  await withEnvironment({ OMPDESK_PASSWORD: undefined, OMPDESK_AUTH_FILE: authFile }, async () => {
    const response = proxy(makeRequest("/api/sessions"));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
  });
  flushLogs();

  const record = securityRecord(dir, "security.auth.unavailable");
  assert.equal(record.level, "warn");
  assert.equal(record.reason, "credential-file-unreadable");
  assert.equal(record.route, "/api/sessions");
  assert.equal(record.method, "GET");
  assert.match(record.requestId, UUID_V4);
  assert.equal(readRawLog(dir).includes(authFile), false);
});

test("logs recovery-surface access with the forwarded request id", async (t) => {
  const dir = await useTempTransport(t);
  const requestIds = new Map();
  await withEnvironment({
    OMPDESK_PASSWORD: "correct-horse-battery",
    OMPDESK_AUTH_FILE: missingAuthFile(t),
  }, async () => {
    for (const pathname of ["/recover", "/api/web-access/recovery"]) {
      const response = proxy(makeRequest(pathname));
      requestIds.set(
        pathname,
        response.headers.get("x-middleware-request-x-ompdesk-request-id"),
      );
    }
  });
  flushLogs();

  const records = readRecords(dir).filter((entry) => entry.message === "security.recovery.access");
  assert.equal(records.length, 2);
  for (const record of records) {
    assert.equal(record.level, "info");
    assert.equal(record.reason, "recovery-surface");
    assert.equal(record.method, "GET");
    assert.equal(record.requestId, requestIds.get(record.route));
  }
});

test("logs recovery code issue and redemption without the code or the passwords", async (t) => {
  const dir = await useTempTransport(t);
  const authFile = missingAuthFile(t);
  const initialPassword = "initial-password-123";
  const recoveredPassword = "recovered-password-123";
  const wrongCode = "0000-0000-0000";

  store.setWebPassword(initialPassword, { file: authFile, env: {} });
  t.after(() => store.clearVerificationCache());

  const printed = [];
  const originalWrite = process.stdout.write;
  let issuedCode;
  await withEnvironment({ OMPDESK_PASSWORD: undefined, OMPDESK_AUTH_FILE: authFile }, async () => {
    process.stdout.write = (chunk) => {
      printed.push(String(chunk));
      return true;
    };
    try {
      const response = await recoveryPost(new Request("http://localhost:30141/api/web-access/recovery", {
        method: "POST",
        headers: {
          host: "localhost:30141",
          "content-type": "application/json",
          "x-ompdesk-request-id": "recovery-issue-1",
        },
        body: JSON.stringify({ action: "request" }),
      }));
      assert.equal(response.status, 200);
    } finally {
      process.stdout.write = originalWrite;
    }
    issuedCode = /Recovery code:\s*([0-9A-Z-]+)/.exec(printed.join(""))?.[1];
    assert.ok(issuedCode, `expected the code on stdout, got ${printed.join("")}`);

    const rejected = await recoveryPost(new Request("http://localhost:30141/api/web-access/recovery", {
      method: "POST",
      headers: {
        host: "localhost:30141",
        "content-type": "application/json",
        "x-ompdesk-request-id": "recovery-redeem-bad",
      },
      body: JSON.stringify({ action: "complete", code: wrongCode, password: recoveredPassword }),
    }));
    assert.equal(rejected.status, 403);

    const redeemed = await recoveryPost(new Request("http://localhost:30141/api/web-access/recovery", {
      method: "POST",
      headers: {
        host: "localhost:30141",
        "content-type": "application/json",
        "x-ompdesk-request-id": "recovery-redeem-1",
      },
      body: JSON.stringify({ action: "complete", code: issuedCode, password: recoveredPassword }),
    }));
    assert.equal(redeemed.status, 200);
  });
  flushLogs();

  const issued = securityRecord(dir, "security.recovery.code.issued");
  assert.equal(issued.level, "info");
  assert.equal(issued.ok, true);
  assert.equal(issued.requestId, "recovery-issue-1");
  assert.equal(issued.route, "/api/web-access/recovery");
  assert.equal(issued.method, "POST");

  const redemptions = readRecords(dir).filter((entry) => entry.message === "security.recovery.code.redeemed");
  assert.equal(redemptions.length, 2);
  const failed = redemptions.find((entry) => entry.requestId === "recovery-redeem-bad");
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, "invalid-code");
  assert.equal(failed.level, "warn");
  const succeeded = redemptions.find((entry) => entry.requestId === "recovery-redeem-1");
  assert.equal(succeeded.ok, true);
  assert.equal(succeeded.level, "info");

  const raw = readRawLog(dir);
  for (const secret of [issuedCode, wrongCode, initialPassword, recoveredPassword]) {
    assert.equal(raw.includes(secret), false, secret);
  }
});

test("control channel answers only with the token this run was started with", async (t) => {
  const dir = await useTempTransport(t);
  const token = "a".repeat(48);

  await withEnvironment({ OMPDESK_CONTROL_TOKEN: token, OMPDESK_PASSWORD: undefined }, async () => {
    const missing = proxy(makeRequest("/api/control/activity"));
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("x-content-type-options"), "nosniff");

    const wrong = proxy(makeRequest("/api/control/activity", { "x-ompdesk-control-token": "b".repeat(48) }));
    assert.equal(wrong.status, 404);

    const allowed = proxy(makeRequest("/api/control/activity", { "x-ompdesk-control-token": token }));
    assert.equal(allowed.status, 200);
  });
  flushLogs();

  const access = securityRecord(dir, "security.control.access");
  assert.equal(access.level, "info");
  assert.equal(access.reason, "control-token");
  assert.equal(access.route, "/api/control/activity");

  // Denials must not leave an access record behind.
  const accesses = readRecords(dir).filter((entry) => entry.message === "security.control.access");
  assert.equal(accesses.length, 1);
  assert.equal(readRawLog(dir).includes(token), false, "the token itself must never be logged");
});

test("control channel is closed when no token was issued for this run", async (t) => {
  await useTempTransport(t);
  await withEnvironment({ OMPDESK_CONTROL_TOKEN: undefined, OMPDESK_PASSWORD: undefined }, async () => {
    const response = proxy(makeRequest("/api/control/activity", { "x-ompdesk-control-token": "a".repeat(48) }));
    assert.equal(response.status, 404);
  });
});
