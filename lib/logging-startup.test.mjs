import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const {
  buildProcessStartFields,
  readAppVersion,
  resolveListenAddress,
  resolveStartupMode,
  startLogging,
} = await import("./logging-startup.ts");
const { flushLogs } = await import("./logging.ts");

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

test("derives the listen address from env or the CLI flags Next was started with", () => {
  assert.equal(
    resolveListenAddress({ OMPDESK_HOSTNAME: "0.0.0.0", PORT: "8080" }, []),
    "http://0.0.0.0:8080",
  );
  assert.equal(
    resolveListenAddress({}, ["bun", "next", "start", "-H", "127.0.0.1", "-p", "30141"]),
    "http://127.0.0.1:30141",
  );
  assert.equal(
    resolveListenAddress({}, ["bun", "next", "start", "--hostname=::1", "--port=4000"]),
    "http://[::1]:4000",
  );
  assert.equal(resolveListenAddress({}, ["bun", "next", "start"]), "http://127.0.0.1:30141");
  // Empty variables mean unset; they must not produce `http://:30141`.
  assert.equal(
    resolveListenAddress({ OMPDESK_HOSTNAME: "", PORT: "  " }, []),
    "http://127.0.0.1:30141",
  );
});

test("distinguishes production and development startup", () => {
  assert.equal(resolveStartupMode({ NODE_ENV: "production" }), "production");
  assert.equal(resolveStartupMode({ NODE_ENV: "development" }), "development");
});

test("builds every process.start field from its inputs", () => {
  assert.deepEqual(
    buildProcessStartFields({
      env: { NODE_ENV: "production", OMPDESK_HOSTNAME: "127.0.0.1", PORT: "30141" },
      argv: ["bun", "next", "start", "-p", "30199"],
      pid: 321,
      version: "0.5.1",
      runtime: "bun 1.3.14",
      authEnabled: true,
    }),
    {
      version: "0.5.1",
      runtime: "bun 1.3.14",
      listenAddress: "http://127.0.0.1:30141",
      authEnabled: true,
      mode: "production",
      pid: 321,
    },
  );
});

test("reads the application version from package.json", () => {
  const version = readAppVersion();
  assert.match(version, /^\d+\.\d+\.\d+/);
});

test("writes process.start with version, runtime, address, auth, mode, and PID", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-startup-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  await startLogging({
    file: dir,
    stdout: false,
    env: { NODE_ENV: "production", OMPDESK_HOSTNAME: "127.0.0.1", PORT: "30141" },
    authEnabled: true,
    fields: { pid: 9876, version: "9.9.9", runtime: "bun 1.4.0" },
  });
  flushLogs();

  const record = readRecords(dir).find((item) => item.message === "process.start");
  assert.ok(record, "process.start record");
  assert.equal(record.source, "ompdesk");
  assert.equal(record.subsystem, "process");
  assert.equal(record.level, "info");
  assert.equal(record.version, "9.9.9");
  assert.equal(record.runtime, "bun 1.4.0");
  assert.equal(record.listenAddress, "http://127.0.0.1:30141");
  assert.equal(record.authEnabled, true);
  assert.equal(record.mode, "production");
  assert.equal(record.pid, 9876);
});
