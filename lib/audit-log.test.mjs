import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { configureLogging, flushLogs, runWithLogContext } = await import("./logging.ts");
const {
  auditFailure,
  auditSuccess,
  recordAudit,
  sanitizeAuditDetails,
  sanitizeAuditTarget,
} = await import("./audit-log.ts");

function createLogDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-audit-log-"));
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

function auditRecord(records) {
  const record = records.find((entry) => entry.subsystem === "audit");
  assert.ok(record, `expected an audit record, got ${JSON.stringify(records)}`);
  return record;
}

test("writes a success record with actor and request id from the log context", async (t) => {
  const dir = await useTempTransport(t);

  runWithLogContext(
    { requestId: "req-audit-1", actor: "password", route: "/api/sessions/[id]", method: "DELETE" },
    () => auditSuccess("session.delete", "session-1", { status: 200 }),
  );
  flushLogs();

  const record = auditRecord(readRecords(dir));
  assert.equal(record.message, "audit.session.delete");
  assert.equal(record.subsystem, "audit");
  assert.equal(record.level, "info");
  assert.equal(record.action, "session.delete");
  assert.equal(record.target, "session-1");
  assert.equal(record.outcome, "success");
  assert.equal(record.actor, "password");
  assert.equal(record.requestId, "req-audit-1");
  assert.equal(record.status, 200);
  assert.equal(record.source, "ompdesk");
});

test("writes a failure record at warn level", async (t) => {
  const dir = await useTempTransport(t);

  runWithLogContext({ requestId: "req-audit-2", actor: "local" }, () => {
    auditFailure("worktree.remove", "/repo/.worktrees/feature", { status: 409, reason: "dirty" });
  });
  flushLogs();

  const record = auditRecord(readRecords(dir));
  assert.equal(record.message, "audit.worktree.remove");
  assert.equal(record.level, "warn");
  assert.equal(record.action, "worktree.remove");
  assert.equal(record.target, "/repo/.worktrees/feature");
  assert.equal(record.outcome, "failure");
  assert.equal(record.actor, "local");
  assert.equal(record.requestId, "req-audit-2");
  assert.equal(record.status, 409);
  assert.equal(record.reason, "dirty");
});

test("records an audit event outside a request context without inventing correlation", async (t) => {
  const dir = await useTempTransport(t);

  recordAudit({ action: "settings.write", target: "theme.dark", outcome: "success" });
  flushLogs();

  const record = auditRecord(readRecords(dir));
  assert.equal(record.requestId, undefined);
  assert.equal(record.actor, undefined);
  assert.equal(record.action, "settings.write");
});

test("drops credentials, request bodies, and nested objects from details", async (t) => {
  const dir = await useTempTransport(t);

  runWithLogContext({ requestId: "req-audit-3", actor: "password" }, () => {
    auditSuccess("auth.api-key.set", "openai", {
      apiKey: "sk-live-secret",
      password: "hunter2",
      recoveryCode: "ABCD-EFGH",
      token: "tok-value",
      body: { apiKey: "nested-secret", content: "request body" },
      nested: { password: "nested-password" },
      providers: 2,
    });
  });
  flushLogs();

  const [record] = readRecords(dir);
  assert.equal(record.apiKey, undefined);
  assert.equal(record.password, undefined);
  assert.equal(record.recoveryCode, undefined);
  assert.equal(record.token, undefined);
  assert.equal(record.body, undefined);
  assert.equal(record.nested, undefined);
  assert.equal(record.providers, 2);
  const serialized = JSON.stringify(record);
  for (const secret of ["sk-live-secret", "hunter2", "ABCD-EFGH", "tok-value", "nested-secret", "request body", "nested-password"]) {
    assert.ok(!serialized.includes(secret), `audit record leaked ${secret}`);
  }
});

test("sanitizes targets: URL userinfo, query values, fragments, length", () => {
  assert.equal(sanitizeAuditTarget("session-1"), "session-1");
  assert.equal(sanitizeAuditTarget("  C:\\work\\repo  "), "C:\\work\\repo");
  assert.equal(sanitizeAuditTarget(""), undefined);
  assert.equal(sanitizeAuditTarget("   "), undefined);
  assert.equal(sanitizeAuditTarget(undefined), undefined);
  assert.equal(sanitizeAuditTarget(42), undefined);

  const target = sanitizeAuditTarget("https://alice:s3cret@mcp.example.com/sse?api_key=sk-live&x=1#token");
  assert.ok(target, "a URL target must survive sanitization");
  assert.ok(!target.includes("alice"), target);
  assert.ok(!target.includes("s3cret"), target);
  assert.ok(!target.includes("sk-live"), target);
  assert.ok(!target.includes("#token"), target);
  assert.match(target, /^https:\/\/mcp\.example\.com\/sse\?api_key=redacted&x=redacted$/);

  const long = sanitizeAuditTarget("x".repeat(500));
  assert.ok(long.length <= 201, `target length ${long.length}`);
  assert.ok(long.endsWith("…"), long);
});

test("redacts protocol-relative and unparseable URLs in targets", () => {
  assert.equal(sanitizeAuditTarget("//user:pass@host/path?token=x"), "//host/path?token=redacted");

  const badPort = sanitizeAuditTarget("https://user:pass@host:70000/x?api_key=sk-live#frag");
  assert.equal(badPort, "https://host:70000/x?api_key=redacted");
  assert.ok(!badPort.includes("user"), badPort);
  assert.ok(!badPort.includes("pass"), badPort);
  assert.ok(!badPort.includes("sk-live"), badPort);
  assert.ok(!badPort.includes("#frag"), badPort);

  const embedded = sanitizeAuditTarget("plugin at //user:pass@host/source?token=x done");
  assert.equal(embedded, "plugin at //host/source?token=redacted done");

  // Scheme-less forms carry the same credentials; a bare relative path does not.
  assert.equal(sanitizeAuditTarget("user:pass@host/path?token=x"), "host/path?token=redacted");
  assert.equal(
    sanitizeAuditTarget("api.example.test/sse?api_key=sk-live"),
    "api.example.test/sse?api_key=redacted",
  );
  assert.equal(
    sanitizeAuditTarget("plugin at user:pass@host/source?token=x done"),
    "plugin at host/source?token=redacted done",
  );
  assert.equal(sanitizeAuditTarget("/api/logs?cursor=0"), "/api/logs?cursor=0");
});

test("redacts URLs in detail strings and error messages", () => {
  const details = sanitizeAuditDetails({
    reason: "fetch https://user:pass@host/x?token=secret failed",
    protocolRelative: "//user:pass@host/path?token=secret#fragment",
    error: new Error("GET //user:pass@host/path?token=secret#fragment"),
  });

  assert.equal(details.reason, "fetch https://host/x?token=redacted failed");
  assert.equal(details.protocolRelative, "//host/path?token=redacted");
  assert.equal(details.error.message, "GET //host/path?token=redacted");

  const serialized = JSON.stringify(details);
  for (const secret of ["user:", "pass@", "secret", "fragment"]) {
    assert.equal(serialized.includes(secret), false, `detail leaked ${secret}: ${serialized}`);
  }
});

test("keeps authoritative audit fields when details reuse their names", async (t) => {
  const dir = await useTempTransport(t);

  runWithLogContext(
    { requestId: "req-real", actor: "password" },
    () => auditSuccess("session.delete", "real-target", {
      action: "forged.action",
      outcome: "success-forged",
      target: "forged-target",
      actor: "recovery",
      requestId: "forged-id",
      status: 200,
    }),
  );
  flushLogs();

  const record = auditRecord(readRecords(dir));
  assert.equal(record.action, "session.delete");
  assert.equal(record.outcome, "success");
  assert.equal(record.target, "real-target");
  assert.equal(record.actor, "password");
  assert.equal(record.requestId, "req-real");
  assert.equal(record.status, 200);
});

test("bounds details to primitives with capped key count and string length", () => {
  const many = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`field${index}`, index]));
  const bounded = sanitizeAuditDetails({
    stack: "y".repeat(500),
    body: { secret: "value" },
    list: [1, 2, 3],
    error: new Error("boom"),
    ...many,
  });

  assert.ok(Object.keys(bounded).length <= 13, JSON.stringify(Object.keys(bounded)));
  assert.ok(bounded._truncated, "an over-full detail set must say it was truncated");
  assert.ok(String(bounded.stack).length <= 201, String(bounded.stack).length);
  assert.equal(bounded.body, undefined);
  assert.equal(bounded.list, undefined);
  assert.equal(bounded.error.message, "boom");
  assert.equal(bounded.error.name, "Error");
});

test("never throws, even for malformed input", async (t) => {
  const dir = await useTempTransport(t);
  const circular = {};
  circular.self = circular;

  assert.doesNotThrow(() => {
    recordAudit({ action: 42, outcome: "unknown", target: {}, details: circular });
    recordAudit(undefined);
    auditSuccess("", null, { value: circular });
  });
  flushLogs();

  for (const record of readRecords(dir)) {
    assert.equal(record.subsystem, "audit");
  }
});
