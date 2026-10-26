import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ModelRegistry, Settings, discoverAuthStorage } from "@oh-my-pi/pi-coding-agent";

const OTEL_ENDPOINT_VARS = [
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
  "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
  "OTEL_SDK_DISABLED",
];

function useTempAgentDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-telemetry-"));
}

test("no OTLP endpoint leaves export off and fixes one outcome for the process", async (t) => {
  const saved = new Map(OTEL_ENDPOINT_VARS.map((key) => [key, process.env[key]]));
  for (const key of OTEL_ENDPOINT_VARS) delete process.env[key];
  const dir = useTempAgentDir();
  const authStorage = await discoverAuthStorage(dir);
  t.after(() => {
    authStorage.close();
    fs.rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const modelRegistry = new ModelRegistry(authStorage, path.join(dir, "models.yml"), {
    cacheDbPath: path.join(dir, "models-cache.db"),
  });
  const settings = Settings.isolated({});
  const { flushSessionTelemetry, sessionTelemetry } = await import("./telemetry.ts");

  // Both concurrent and sequential calls read the same memoized outcome: the
  // first session does not get its own initialization attempt.
  const [first, second] = await Promise.all([
    sessionTelemetry(settings, modelRegistry),
    sessionTelemetry(settings, modelRegistry),
  ]);
  assert.equal(first, undefined);
  assert.equal(second, undefined);
  assert.equal(await sessionTelemetry(settings, modelRegistry), undefined);
  assert.equal(await globalThis.__ompTelemetryStarted, false);

  // A flush with no registered providers is a no-op and never rejects.
  await flushSessionTelemetry();
});
