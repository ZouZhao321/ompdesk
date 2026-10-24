import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const loggingModule = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "logging.ts")).href;

/**
 * A route bundle owns a copy of `lib/logging.ts` that never runs
 * instrumentation. Logging there must resolve the shared transport on first
 * use instead of silently dropping the record.
 */
test("writes a record from a module instance that was never configured", { timeout: 30_000 }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-log-bootstrap-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const script = path.join(root, "probe.mjs");
  fs.writeFileSync(script, `
import { logEvent, flushLogs } from ${JSON.stringify(loggingModule)};
logEvent("info", "system", "bootstrap.probe", { probe: "lazy" });
await new Promise((resolve) => setTimeout(resolve, 1_500));
flushLogs();
process.exit(0);
`);

  execFileSync(process.execPath, [script], {
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      XDG_STATE_HOME: path.join(root, "xdg-state"),
      XDG_DATA_HOME: path.join(root, "xdg-data"),
      XDG_CACHE_HOME: path.join(root, "xdg-cache"),
      OMPDESK_LOG_STDOUT: "0",
      PI_CONFIG_DIR: ".omp",
      OMP_LOG_LEVEL: "debug",
    },
    stdio: "pipe",
    timeout: 30_000,
  });

  const records = [];
  for (const entry of fs.readdirSync(root, { recursive: true })) {
    const file = path.join(root, String(entry));
    if (!file.endsWith(".log") || !fs.statSync(file).isFile()) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      if (line.trim()) records.push(JSON.parse(line));
    }
  }

  const record = records.find((entry) => entry.message === "bootstrap.probe");
  assert.ok(record, `expected the probe record, got ${JSON.stringify(records)}`);
  assert.equal(record.source, "ompdesk");
  assert.equal(record.subsystem, "system");
  assert.equal(record.level, "info");
  assert.equal(record.probe, "lazy");
});
