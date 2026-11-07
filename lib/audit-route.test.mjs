import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { configureLogging, flushLogs } = await import("./logging.ts");
const { cacheSessionPath, invalidateSessionPathCache } = await import("./session-reader.ts");

function createDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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
  const dir = createDir(t, "ompdesk-audit-route-");
  await configureLogging({ file: dir, stdout: false, env: { NODE_ENV: "production" } });
  return dir;
}

function routeRequest(url, { method = "POST", body, requestId, actor } = {}) {
  return new Request(url, {
    method,
    headers: {
      host: "localhost:30141",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(requestId ? { "x-ompdesk-request-id": requestId } : {}),
      ...(actor ? { "x-ompdesk-actor": actor } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("session delete records an audit success for the deleted session", async (t) => {
  const logDir = await useTempTransport(t);
  const sessionDir = createDir(t, "ompdesk-audit-session-");
  const sessionId = "audit-session-delete";
  const sessionFile = path.join(sessionDir, `${sessionId}.jsonl`);
  fs.writeFileSync(
    sessionFile,
    [
      JSON.stringify({
        type: "session",
        id: sessionId,
        cwd: sessionDir,
        timestamp: new Date().toISOString(),
      }),
      JSON.stringify({ type: "message", message: { role: "user", content: "hello" } }),
    ].join("\n"),
    "utf8",
  );
  cacheSessionPath(sessionId, sessionFile);
  t.after(() => invalidateSessionPathCache(sessionId));

  const { DELETE } = await import("../app/api/sessions/[id]/route.ts");
  const response = await DELETE(
    routeRequest(`http://localhost:30141/api/sessions/${sessionId}`, {
      method: "DELETE",
      requestId: "req-audit-delete",
      actor: "password",
    }),
    { params: Promise.resolve({ id: sessionId }) },
  );
  assert.equal(response.status, 200);
  assert.equal(fs.existsSync(sessionFile), false, "the session file must be deleted");
  flushLogs();

  const record = readRecords(logDir).find((entry) => entry.message === "audit.session.delete");
  assert.ok(record, "expected audit.session.delete");
  assert.equal(record.subsystem, "audit");
  assert.equal(record.action, "session.delete");
  assert.equal(record.target, sessionId);
  assert.equal(record.outcome, "success");
  assert.equal(record.actor, "password");
  assert.equal(record.requestId, "req-audit-delete");
});

test("a rejected model config write records an audit failure", async (t) => {
  const logDir = await useTempTransport(t);
  const { PUT } = await import("../app/api/models-config/route.ts");

  const response = await PUT(
    routeRequest("http://localhost:30141/api/models-config", {
      method: "PUT",
      body: { providers: "not-an-object", apiKey: "sk-live-secret" },
      requestId: "req-audit-models",
      actor: "local",
    }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "providers must be an object" });
  flushLogs();

  const records = readRecords(logDir);
  const record = records.find((entry) => entry.message === "audit.models.config.write");
  assert.ok(record, "expected audit.models.config.write");
  assert.equal(record.subsystem, "audit");
  assert.equal(record.action, "models.config.write");
  assert.equal(record.outcome, "failure");
  assert.equal(record.level, "warn");
  assert.equal(record.status, 400);
  assert.equal(record.actor, "local");
  assert.equal(record.requestId, "req-audit-models");
  assert.ok(record.target.endsWith("models.yml"), record.target);
  assert.ok(!JSON.stringify(records).includes("sk-live-secret"), "the request body must not be audited");
});
