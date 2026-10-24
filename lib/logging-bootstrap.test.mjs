import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const libDir = path.dirname(fileURLToPath(import.meta.url));
const loggingPath = path.join(libDir, "logging.ts");
const loggingModule = pathToFileURL(loggingPath).href;

function isolatedEnvironment(root) {
  return {
    ...process.env,
    HOME: root,
    USERPROFILE: root,
    XDG_STATE_HOME: path.join(root, "xdg-state"),
    XDG_DATA_HOME: path.join(root, "xdg-data"),
    XDG_CACHE_HOME: path.join(root, "xdg-cache"),
    PI_CONFIG_DIR: ".omp",
    OMP_LOG_LEVEL: "debug",
  };
}

function readRecords(directory) {
  const records = [];
  if (!fs.existsSync(directory)) return records;
  for (const entry of fs.readdirSync(directory, { recursive: true })) {
    const file = path.join(directory, String(entry));
    if (!file.endsWith(".log") || !fs.statSync(file).isFile()) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      if (line.trim()) records.push(JSON.parse(line));
    }
  }
  return records;
}

function runProbe(root, source, overrides = {}) {
  const script = path.join(root, `probe-${Date.now()}.mjs`);
  fs.writeFileSync(script, source);
  return execFileSync(process.execPath, [script], {
    env: { ...isolatedEnvironment(root), ...overrides },
    encoding: "utf8",
    timeout: 30_000,
  });
}

/**
 * A route bundle owns a copy of `lib/logging.ts` that never runs
 * instrumentation. Logging there must resolve the shared transport on first
 * use instead of silently dropping the record.
 */
test("writes a record from a module instance that was never configured", { timeout: 30_000 }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-log-bootstrap-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const stdout = runProbe(root, `
import { logEvent, flushLogs } from ${JSON.stringify(loggingModule)};
logEvent("info", "system", "bootstrap.probe", { probe: "lazy" });
await new Promise((resolve) => setTimeout(resolve, 1_500));
flushLogs();
process.exit(0);
`, { OMPDESK_LOG_STDOUT: "0" });
  assert.equal(stdout.includes("bootstrap.probe"), false, "OMPDESK_LOG_STDOUT=0 must keep stdout quiet");

  const record = readRecords(root).find((entry) => entry.message === "bootstrap.probe");
  assert.ok(record, "expected the probe record in the default log directory");
  assert.equal(record.source, "ompdesk");
  assert.equal(record.subsystem, "system");
  assert.equal(record.level, "info");
  assert.equal(record.probe, "lazy");
});

/**
 * A second module instance must not replace a transport policy the process
 * already applied. The proxy/instrumentation bundle configures the file; the
 * route bundle only resolves the logger and writes through it.
 */
test("keeps an explicit transport when another module instance logs first", { timeout: 30_000 }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-log-explicit-"));
  const explicitLogs = path.join(root, "explicit-logs");
  fs.mkdirSync(explicitLogs);
  const copyPath = path.join(libDir, `.tmp-logging-copy-${process.pid}-${Date.now()}.ts`);
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(copyPath, { force: true });
  });

  fs.copyFileSync(loggingPath, copyPath);
  const stdout = runProbe(root, `
import { configureLogging } from ${JSON.stringify(loggingModule)};
import { logEvent, flushLogs } from ${JSON.stringify(pathToFileURL(copyPath).href)};
await configureLogging({
  file: ${JSON.stringify(explicitLogs)},
  stdout: false,
  env: { NODE_ENV: "production" },
});
logEvent("info", "system", "explicit.transport.probe", { probe: "explicit" });
await new Promise((resolve) => setTimeout(resolve, 1_500));
flushLogs();
process.exit(0);
`, { OMPDESK_LOG_STDOUT: "1" });

  assert.equal(stdout.includes("explicit.transport.probe"), false, "stdout:false must survive the second instance");

  const configuredRecords = readRecords(explicitLogs);
  assert.ok(
    configuredRecords.some((entry) => entry.message === "explicit.transport.probe"),
    `expected the record in the configured directory, got ${JSON.stringify(configuredRecords)}`,
  );
  const defaultRecords = readRecords(path.join(root, ".omp"));
  assert.equal(
    defaultRecords.some((entry) => entry.message === "explicit.transport.probe"),
    false,
    "the second instance must not redirect the record to the default log directory",
  );
});
