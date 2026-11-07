import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ModelRegistry, Settings, discoverAuthStorage } from "@oh-my-pi/pi-coding-agent";

const OTEL_VARS = [
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
  "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
  "OTEL_EXPORTER_OTLP_PROTOCOL",
  "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL",
  "OTEL_EXPORTER_OTLP_LOGS_PROTOCOL",
  "OTEL_EXPORTER_OTLP_METRICS_PROTOCOL",
  "OTEL_TRACES_EXPORTER",
  "OTEL_LOGS_EXPORTER",
  "OTEL_METRICS_EXPORTER",
  "OTEL_SDK_DISABLED",
];

function useTempAgentDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-telemetry-"));
}

async function makeModelRegistry(dir) {
  const authStorage = await discoverAuthStorage(dir);
  return new ModelRegistry(authStorage, path.join(dir, "models.yml"), {
    cacheDbPath: path.join(dir, "models-cache.db"),
  });
}

// Provider registration is process-wide and irreversible, so the enabled path
// runs in its own process. Its output goes to the collector started below.
if (process.env.OMPDESK_TELEMETRY_CHILD === "1") {
  const resultLine = (value) => `OMPDESK_TELEMETRY_RESULT ${JSON.stringify(value)}\n`;
  const dir = process.env.OMPDESK_TELEMETRY_DIR;
  const modelRegistry = await makeModelRegistry(dir);
  const { flushSessionTelemetry, sessionTelemetry } = await import("./telemetry.ts");
  const { trace } = await import("@opentelemetry/api");
  const config = await sessionTelemetry(Settings.isolated({}), modelRegistry);
  if (config === undefined) {
    process.stdout.write(resultLine({ config: null }), () => process.exit(2));
  } else {
    trace.getTracer("telemetry-test").startSpan("telemetry-test-span").end();
    await flushSessionTelemetry(5000);
    process.stdout.write(resultLine({ config: Object.keys(config) }), () => process.exit(0));
  }
}

test("no OTLP endpoint leaves export off and fixes one outcome for the process", async (t) => {
  const savedEnv = new Map(OTEL_VARS.map((key) => [key, process.env[key]]));
  for (const key of OTEL_VARS) delete process.env[key];
  const savedStarted = globalThis.__ompTelemetryStarted;
  const savedTimedOut = globalThis.__ompTelemetryInitTimedOut;
  const dir = useTempAgentDir();
  const authStorage = await discoverAuthStorage(dir);
  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...args) => {
    logged.push(args);
  };
  t.after(() => {
    console.error = originalConsoleError;
    globalThis.__ompTelemetryStarted = savedStarted;
    globalThis.__ompTelemetryInitTimedOut = savedTimedOut;
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

  // Configuring an endpoint afterwards does not start export: the process-wide
  // outcome was already fixed, so a per-session init would show up here.
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:43199";
  process.env.OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf";
  assert.equal(await sessionTelemetry(settings, modelRegistry), undefined);
  assert.deepEqual(logged, []);

  // A flush with no registered providers is a no-op and never rejects.
  await flushSessionTelemetry();
  assert.deepEqual(logged, []);
});

test("an init that never settles reports no export after the timeout", async () => {
  const { settleTelemetryInit } = await import("./telemetry.ts");
  const pending = Promise.withResolvers();
  let timeouts = 0;
  const active = await settleTelemetryInit(
    pending.promise,
    () => false,
    20,
    () => {
      timeouts += 1;
    },
  );
  assert.equal(active, false);
  assert.equal(timeouts, 1);
});

test("a settled init reports the provider's live state", async () => {
  const { settleTelemetryInit } = await import("./telemetry.ts");
  const active = await settleTelemetryInit(
    Promise.resolve(),
    () => true,
    20,
    () => {
      throw new Error("must not time out");
    },
  );
  assert.equal(active, true);
});

test(
  "a configured endpoint builds the session config and exports a trace",
  { timeout: 30_000 },
  async (t) => {
    const dir = useTempAgentDir();
    const requests = [];
    const server = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        requests.push(`${req.method} ${req.url}`);
        res.writeHead(200, { "content-type": "application/x-protobuf" });
        res.end();
      });
    });
    const listening = Promise.withResolvers();
    server.once("error", listening.reject);
    server.listen(0, "127.0.0.1", listening.resolve);
    await listening.promise;
    t.after(() => {
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const address = server.address();
    assert.ok(
      address !== null && typeof address !== "string",
      "collector must listen on a TCP port",
    );
    const { port } = address;

    const childEnv = { ...process.env };
    for (const key of OTEL_VARS) delete childEnv[key];
    Object.assign(childEnv, {
      OMPDESK_TELEMETRY_CHILD: "1",
      OMPDESK_TELEMETRY_DIR: dir,
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
    });
    const child = Bun.spawn(["bun", fileURLToPath(import.meta.url)], {
      env: childEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    assert.equal(await child.exited, 0, `${stdout}\n${stderr}`);

    const prefix = "OMPDESK_TELEMETRY_RESULT ";
    const resultText = stdout.split(/\r?\n/).find((line) => line.startsWith(prefix));
    assert.ok(resultText, `child result missing\n${stdout}\n${stderr}`);
    const result = JSON.parse(resultText.slice(prefix.length));
    assert.deepEqual(result.config, [
      "costEstimator",
      "onChatUsage",
      "onRunEnd",
      "onTelemetryWarning",
    ]);
    assert.ok(requests.includes("POST /v1/traces"), requests.join(", "));
  },
);
