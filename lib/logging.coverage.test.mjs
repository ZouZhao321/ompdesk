import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const root = process.cwd();
const workDir = path.join(root, ".tmp", "lib-logic-two");
const logsDir = path.join(workDir, `logging-${process.pid}-${Date.now()}`);
fs.mkdirSync(logsDir, { recursive: true });

const jiti = createJiti(import.meta.url, {
  alias: { "@": root },
  interopDefault: true,
  moduleCache: false,
});
const logging = await jiti.import(path.join(root, "lib", "logging.ts"));

/** 每个用例都显式打开 stdout 镜像，让记录也经过格式化路径。 */
async function configure(stdout = true) {
  await logging.configureLogging({ file: logsDir, stdout, env: { NODE_ENV: "production" } });
}

function readRecords() {
  if (!fs.existsSync(logsDir)) return [];
  return fs
    .readdirSync(logsDir)
    .flatMap((name) => fs.readFileSync(path.join(logsDir, name), "utf8").split(/\r?\n/))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test.after(() => {
  logging.flushLogs();
  fs.rmSync(logsDir, { recursive: true, force: true });
});

test("writes sanitized records while the stdout mirror is enabled", async () => {
  await configure(true);
  logging.logEvent("info", "system", "mirror.coverage", {
    keep: "visible",
    authorization: "Bearer leak",
    nested: { count: 2 },
  });
  logging.flushLogs();

  const record = readRecords().find((entry) => entry.message === "mirror.coverage");
  assert.ok(record, `expected mirror.coverage, got ${JSON.stringify(readRecords())}`);
  assert.equal(record.level, "info");
  assert.equal(record.keep, "visible");
  assert.equal(record.nested.count, 2);
  assert.equal(record.authorization, undefined);
  assert.equal(record.source, "ompdesk");
});

test("keeps unknown levels on the mirror policy and still writes the record", async () => {
  await configure(true);
  const savedLevel = process.env.OMP_LOG_LEVEL;
  try {
    process.env.OMP_LOG_LEVEL = "verbose";
    logging.logEvent("debug", "system", "mirror.level.debug");
    logging.flushLogs();
  } finally {
    if (savedLevel === undefined) delete process.env.OMP_LOG_LEVEL;
    else process.env.OMP_LOG_LEVEL = savedLevel;
  }

  assert.ok(readRecords().some((entry) => entry.message === "mirror.level.debug"));
});

test("mirrors SDK-owned template records without inventing fields", async () => {
  await configure(true);
  const { info } = await import("@oh-my-pi/pi-utils/logger");

  info("template %s", { shouldNotAppear: "value" });
  logging.flushLogs();

  const record = readRecords().find((entry) => entry.message.startsWith("template %s"));
  assert.ok(record, `template record: ${JSON.stringify(readRecords().slice(-3))}`);
  assert.equal(record.shouldNotAppear, undefined);
});

test("writes through an instance that never called configureLogging", async () => {
  await configure(false);
  const freshUrl = new URL(`./logging.ts?bootstrap=${Date.now()}`, import.meta.url).href;
  const routeBundle = await import(freshUrl);
  const { stopMemoryMonitor } = await import("./memory-monitor.ts");

  try {
    routeBundle.logEvent("warn", "system", "bootstrap.coverage", { probe: "lazy" });
    await new Promise((resolve) => setTimeout(resolve, 250));
    routeBundle.flushLogs();
    logging.flushLogs();
  } finally {
    stopMemoryMonitor();
  }

  const record = readRecords().find((entry) => entry.message === "bootstrap.coverage");
  assert.ok(record, `expected bootstrap record, got ${JSON.stringify(readRecords().slice(-5))}`);
  assert.equal(record.level, "warn");
  assert.equal(record.probe, "lazy");
});
