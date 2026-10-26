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
  const savedEnv = new Map(OTEL_ENDPOINT_VARS.map((key) => [key, process.env[key]]));
  for (const key of OTEL_ENDPOINT_VARS) delete process.env[key];
  const savedOutcome = globalThis.__ompTelemetryStarted;
  const dir = useTempAgentDir();
  const authStorage = await discoverAuthStorage(dir);
  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...args) => {
    logged.push(args);
  };
  t.after(() => {
    console.error = originalConsoleError;
    globalThis.__ompTelemetryStarted = savedOutcome;
    authStorage.close();
    fs.rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const modelRegistry = new ModelRegistry(authStorage, path.join(dir, "models.yml"), {
    cacheDbPath: path.join(dir, "models-cache.db"),
  });
  const settings = Settings.isolated({});
  const { flushSessionTelemetry, sessionTelemetry } = await import("./telemetry.ts");

  // Concurrent calls share one initialization attempt.
  const [first, second] = await Promise.all([
    sessionTelemetry(settings, modelRegistry),
    sessionTelemetry(settings, modelRegistry),
  ]);
  assert.equal(first, undefined);
  assert.equal(second, undefined);
  assert.equal(await globalThis.__ompTelemetryStarted, false);

  // Configuring an endpoint afterwards does not start export: the process-wide
  // outcome was already fixed, so a per-session init would show up here.
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:43199";
  process.env.OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf";
  assert.equal(await sessionTelemetry(settings, modelRegistry), undefined);
  assert.equal(await globalThis.__ompTelemetryStarted, false);
  assert.deepEqual(logged, []);

  // A flush with no registered providers is a no-op and never rejects.
  await flushSessionTelemetry();
});
