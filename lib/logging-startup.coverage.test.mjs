import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const { describeRuntime, startLogging } = await import("./logging-startup.ts");
const { flushLogs } = await import("./logging.ts");

const workDir = path.join(process.cwd(), ".tmp", "lib-logic-two");
fs.mkdirSync(workDir, { recursive: true });

function readRecords(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .flatMap((name) => fs.readFileSync(path.join(directory, name), "utf8").split(/\r?\n/))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("describeRuntime prefers bun and falls back to node", () => {
  assert.equal(describeRuntime({ bun: "1.4.2", node: "22.0.0" }), "bun 1.4.2");
  assert.equal(describeRuntime({ node: "22.0.0" }), "node 22.0.0");
});

test("startLogging detects the auth store through the launcher module", async (t) => {
  const logsDir = path.join(workDir, `startup-detect-${process.pid}-${Date.now()}`);
  fs.mkdirSync(logsDir, { recursive: true });
  t.after(() => fs.rmSync(logsDir, { recursive: true, force: true }));

  await startLogging({
    file: logsDir,
    stdout: false,
    env: { NODE_ENV: "production", OMPDESK_HOSTNAME: "127.0.0.1", PORT: "30141" },
  });
  flushLogs();

  const record = readRecords(logsDir).find((entry) => entry.message === "process.start");
  assert.ok(record, "process.start record");
  assert.equal(typeof record.authEnabled, "boolean");
  assert.equal(record.mode, "production");
  assert.equal(record.listenAddress, "http://127.0.0.1:30141");
});

test("startLogging falls back to OMPDESK_PASSWORD when the launcher module is missing", async (t) => {
  const logsDir = path.join(workDir, `startup-fallback-${process.pid}-${Date.now()}`);
  const emptyCwd = path.join(workDir, `empty-cwd-${process.pid}-${Date.now()}`);
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(emptyCwd, { recursive: true });

  const previousCwd = process.cwd();
  const previousPassword = process.env.OMPDESK_PASSWORD;
  process.env.OMPDESK_PASSWORD = "launch-password";
  process.chdir(emptyCwd);
  try {
    await startLogging({
      file: logsDir,
      stdout: false,
      env: { NODE_ENV: "development" },
    });
    flushLogs();
  } finally {
    process.chdir(previousCwd);
    if (previousPassword === undefined) delete process.env.OMPDESK_PASSWORD;
    else process.env.OMPDESK_PASSWORD = previousPassword;
    fs.rmSync(emptyCwd, { recursive: true, force: true });
  }
  t.after(() => fs.rmSync(logsDir, { recursive: true, force: true }));

  const records = readRecords(logsDir);
  const warning = records.find((entry) => entry.message === "process.auth.detect-failed");
  assert.ok(warning, `expected a detect-failed record, got ${JSON.stringify(records)}`);
  assert.equal(warning.level, "warn");
  const started = records.find((entry) => entry.message === "process.start");
  assert.equal(started.authEnabled, true);
  assert.equal(started.mode, "development");
});
