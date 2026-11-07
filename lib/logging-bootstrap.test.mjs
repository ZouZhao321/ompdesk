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

/** Structured records the mirror wrote to the probe's stdout. */
function stdoutRecords(stdout) {
  const records = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith("{")) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // A partial or non-record line is not a mirror record.
    }
  }
  return records;
}

function runProbe(root, source, overrides = {}, scriptDir = root) {
  const script = path.join(scriptDir, `.tmp-probe-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(script, source);
  try {
    return execFileSync(process.execPath, [script], {
      env: { ...isolatedEnvironment(root), ...overrides },
      encoding: "utf8",
      timeout: 30_000,
    });
  } finally {
    fs.rmSync(script, { force: true });
  }
}

/**
 * A route bundle owns a copy of `lib/logging.ts` that never runs
 * instrumentation. Logging there must resolve the shared transport on first
 * use instead of silently dropping the record.
 */
test("writes a record from a module instance that was never configured", { timeout: 30_000 }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-log-bootstrap-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const stdout = runProbe(
    root,
    `
import { logEvent, flushLogs } from ${JSON.stringify(loggingModule)};
logEvent("info", "system", "bootstrap.probe", { probe: "lazy" });
await new Promise((resolve) => setTimeout(resolve, 1_500));
flushLogs();
process.exit(0);
`,
    { OMPDESK_LOG_STDOUT: "0" },
  );
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
  const stdout = runProbe(
    root,
    `
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
`,
    { OMPDESK_LOG_STDOUT: "1" },
  );

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

/**
 * The SDK console transport ignores `OMP_LOG_LEVEL`; the ompdesk mirror is a
 * log sink instead, so it must apply the same level policy as the file.
 */
test("filters the stdout mirror with OMP_LOG_LEVEL", { timeout: 30_000 }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-log-stdout-level-"));
  const logs = path.join(root, "logs");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const stdout = runProbe(
    root,
    `
import { configureLogging, logEvent, flushLogs } from ${JSON.stringify(loggingModule)};
await configureLogging({ file: ${JSON.stringify(logs)}, stdout: true });
for (const level of ["debug", "info", "warn", "error"]) {
  logEvent(level, "system", "stdout.level." + level);
}
flushLogs();
process.exit(0);
`,
    { OMP_LOG_LEVEL: "warn" },
  );

  const records = stdoutRecords(stdout).filter((entry) => entry.message.startsWith("stdout.level."));
  assert.deepEqual(
    records.map((entry) => entry.message),
    ["stdout.level.warn", "stdout.level.error"],
  );
  assert.deepEqual(
    records.map((entry) => entry.level),
    ["warn", "error"],
  );

  const [record] = records;
  assert.match(record.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
  assert.equal(record.source, "ompdesk");
  assert.equal(record.subsystem, "system");
  assert.equal(typeof record.pid, "number");
});

/**
 * The mirror receives every event the shared SDK logger emits, including the
 * SDK's own records that never passed through `logEvent`. It must sanitize
 * those contexts itself rather than trusting the caller.
 */
test("sanitizes SDK-owned records before mirroring them to stdout", { timeout: 30_000 }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-log-stdout-sanitize-"));
  const logs = path.join(root, "logs");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const stdout = runProbe(
    root,
    `
import { info } from "@oh-my-pi/pi-utils/logger";
import { configureLogging, flushLogs } from ${JSON.stringify(loggingModule)};
await configureLogging({ file: ${JSON.stringify(logs)}, stdout: true });
info("sdk.internal.request", {
  headers: { authorization: "Bearer leak-me" },
  githubToken: "ghp_leak",
  nested: { keep: "visible", token: "nested-leak" },
});
flushLogs();
process.exit(0);
`,
    { OMP_LOG_LEVEL: "debug", OMPDESK_LOG_STDOUT: "1" },
    libDir,
  );

  const records = stdoutRecords(stdout).filter((entry) => entry.message === "sdk.internal.request");
  assert.equal(records.length, 1);
  const [record] = records;
  assert.equal(record.headers.authorization, undefined);
  assert.equal(record.githubToken, undefined);
  assert.equal(record.nested.token, undefined);
  assert.equal(record.nested.keep, "visible");
  assert.equal(stdout.includes("leak-me"), false);
  assert.equal(stdout.includes("ghp_leak"), false);
  assert.equal(stdout.includes("nested-leak"), false);
});

/**
 * A transport that cannot be installed must leave logging disabled, not an
 * unobserved rejected promise: the request that triggered bootstrap must not
 * crash the process, and later calls simply drop their records.
 */
test("survives a throwing SDK transport during lazy bootstrap", { timeout: 30_000 }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-log-bootstrap-failure-"));
  const packageDir = path.join(root, "node_modules", "@oh-my-pi", "pi-utils");
  const copyPath = path.join(root, "logging.ts");
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, "package.json"),
    JSON.stringify({
      name: "@oh-my-pi/pi-utils",
      type: "module",
      exports: { "./logger": "./logger.js" },
    }),
  );
  fs.writeFileSync(
    path.join(packageDir, "logger.js"),
    `
export function registerLogSink() { return () => {}; }
export function setTransports() { throw new Error("transport exploded"); }
export function flush() {}
export function error() {}
export function warn() {}
export function info() {}
export function debug() {}
`,
  );
  fs.copyFileSync(loggingPath, copyPath);
  // The probe runs the copied module outside the project, so its sibling imports
  // must be copied with it.
  fs.copyFileSync(path.join(libDir, "runtime-import.ts"), path.join(root, "runtime-import.ts"));
  fs.copyFileSync(path.join(libDir, "memory-monitor.ts"), path.join(root, "memory-monitor.ts"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const stdout = runProbe(
    root,
    `
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED:" + reason);
  process.exit(7);
});
const { logEvent, flushLogs } = await import(${JSON.stringify(pathToFileURL(copyPath).href)});
logEvent("info", "system", "bootstrap.failure.first", { token: "sk-live" });
await new Promise((resolve) => setTimeout(resolve, 300));
try {
  logEvent("info", "system", "bootstrap.failure.later");
  flushLogs();
} catch (error) {
  console.error("THREW:" + error);
  process.exit(8);
}
console.log("SURVIVED");
process.exit(0);
`,
    { OMPDESK_LOG_STDOUT: "0" },
  );

  assert.equal(stdout.includes("SURVIVED"), true, stdout);
  assert.equal(stdout.includes("UNHANDLED"), false, stdout);
  assert.equal(stdout.includes("THREW"), false, stdout);
});

/** `OMPDESK_LOG_STDOUT=0` must silence the mirror without silencing the file. */
test("keeps stdout quiet when OMPDESK_LOG_STDOUT asks for it", { timeout: 30_000 }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-log-stdout-off-"));
  const logs = path.join(root, "logs");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const stdout = runProbe(
    root,
    `
import { configureLogging, logEvent, flushLogs } from ${JSON.stringify(loggingModule)};
await configureLogging({ file: ${JSON.stringify(logs)} });
logEvent("info", "system", "stdout.off.probe");
flushLogs();
process.exit(0);
`,
    { OMPDESK_LOG_STDOUT: "0", OMP_LOG_LEVEL: "debug" },
  );

  assert.equal(stdout.includes("stdout.off.probe"), false, "OMPDESK_LOG_STDOUT=0 must keep stdout quiet");
  assert.ok(
    readRecords(logs).some((entry) => entry.message === "stdout.off.probe"),
    "the file transport must still receive the record",
  );
});

/**
 * Next compiles route and instrumentation bundles separately, so each owns a
 * copy of the module. The sink lives on the shared SDK logger; registering it
 * twice would print every record twice.
 */
test("registers one stdout sink across module instances", { timeout: 30_000 }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-log-sink-once-"));
  const logs = path.join(root, "logs");
  const copyPath = path.join(libDir, `.tmp-logging-sink-${process.pid}-${Date.now()}.ts`);
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(copyPath, { force: true });
  });

  fs.copyFileSync(loggingPath, copyPath);
  const stdout = runProbe(
    root,
    `
const first = await import(${JSON.stringify(loggingModule)});
const second = await import(${JSON.stringify(pathToFileURL(copyPath).href)});
await first.configureLogging({ file: ${JSON.stringify(logs)}, stdout: true });
await second.configureLogging({ file: ${JSON.stringify(logs)}, stdout: true });
first.logEvent("info", "system", "sink.once.first");
second.logEvent("info", "system", "sink.once.second");
first.flushLogs();
second.flushLogs();
process.exit(0);
`,
    { OMP_LOG_LEVEL: "debug" },
  );

  const mirrored = stdoutRecords(stdout)
    .filter((entry) => entry.message.startsWith("sink.once."))
    .map((entry) => entry.message)
    .sort();
  assert.deepEqual(mirrored, ["sink.once.first", "sink.once.second"]);
});
