import assert from "node:assert/strict";
import { mock } from "bun:test";
import test from "node:test";

// 导出边界：OTLP 的注册与配置由 SDK 负责，这里用替身控制“无端点 / 有端点 /
// 初始化失败 / 超时 / 刷新失败”五种结果，测的是 telemetry.ts 自己的分支。
const exportState = (globalThis.__telemetryExportFake = {});
const settingsState = (globalThis.__telemetrySettingsFake = {});

mock.module("@oh-my-pi/pi-coding-agent/telemetry-export", () => ({
  async initTelemetryExport(enabled) {
    exportState.lastEnabledArg = enabled;
    if (exportState.init === "reject") throw new Error("init exploded");
    if (exportState.init === "pending") return new Promise(() => {});
    return undefined;
  },
  isTelemetryExportEnabled() {
    return exportState.enabled === true;
  },
  createTelemetryExportConfig(_config, resolver) {
    if (exportState.configThrows) throw new Error("config exploded");
    return { priced: resolver("provider", "model") };
  },
  async flushTelemetryExport() {
    if (exportState.flush === "reject") throw new Error("flush exploded");
    if (exportState.flush === "pending") return new Promise(() => {});
    return undefined;
  },
}));

mock.module("@oh-my-pi/pi-coding-agent/telemetry-settings", () => ({
  cfgTelemetryOtlpExportEnabled: {
    get() {
      if (settingsState.throws) throw new Error("settings exploded");
      return settingsState.enabled !== false;
    },
  },
}));

const telemetry = await import("./telemetry.ts");
mock.restore();

function resetGlobals() {
  globalThis.__ompTelemetryStarted = undefined;
  globalThis.__ompTelemetryInitTimedOut = undefined;
  Object.assign(exportState, {
    init: "resolve",
    enabled: false,
    configThrows: false,
    flush: "resolve",
    lastEnabledArg: undefined,
  });
  Object.assign(settingsState, { enabled: true, throws: false });
}

function captureConsoleErrors(t) {
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  t.after(() => {
    console.error = original;
    resetGlobals();
  });
  return logged;
}

test("reports no session telemetry when the export stays disabled", async (t) => {
  resetGlobals();
  const logged = captureConsoleErrors(t);

  assert.equal(await telemetry.sessionTelemetry({}, {}), undefined);
  assert.equal(exportState.lastEnabledArg, true);
  assert.deepEqual(logged, []);
});

test("builds the session config from the provider's live pricing knowledge", async (t) => {
  resetGlobals();
  captureConsoleErrors(t);
  exportState.enabled = true;
  const pricedModel = { cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } };
  const registry = {
    find(providerId, modelId) {
      return providerId === "provider" && modelId === "model" ? pricedModel : undefined;
    },
  };

  assert.deepEqual(await telemetry.sessionTelemetry({}, registry), { priced: true });
  assert.deepEqual(await telemetry.sessionTelemetry({}, { find: () => undefined }), { priced: false });
});

test("keeps the session alive when export initialization fails", async (t) => {
  resetGlobals();
  const logged = captureConsoleErrors(t);
  exportState.init = "reject";

  assert.equal(await telemetry.sessionTelemetry({}, {}), undefined);
  assert.ok(
    logged.some((line) => line.includes("telemetry export init failed")),
    logged.join("\n"),
  );
});

test("keeps the session alive when the export config cannot be built", async (t) => {
  resetGlobals();
  const logged = captureConsoleErrors(t);
  exportState.enabled = true;
  exportState.configThrows = true;

  assert.equal(await telemetry.sessionTelemetry({}, {}), undefined);
  assert.ok(
    logged.some((line) => line.includes("telemetry config failed")),
    logged.join("\n"),
  );
});

test("keeps the session alive when the settings handle throws", async (t) => {
  resetGlobals();
  const logged = captureConsoleErrors(t);
  settingsState.throws = true;

  assert.equal(await telemetry.sessionTelemetry({}, {}), undefined);
  assert.ok(
    logged.some((line) => line.includes("telemetry config failed")),
    logged.join("\n"),
  );
});

test("stops blocking sessions once initialization times out", { timeout: 10_000 }, async (t) => {
  resetGlobals();
  const logged = captureConsoleErrors(t);
  exportState.init = "pending";

  const startedAt = Date.now();
  assert.equal(await telemetry.sessionTelemetry({}, {}), undefined);
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed >= 2_500, `expected the init timeout to elapse, took ${elapsed}ms`);
  assert.ok(
    logged.some((line) => line.includes("telemetry export init timed out")),
    logged.join("\n"),
  );
  assert.equal(globalThis.__ompTelemetryInitTimedOut, true);
});

test("flushes nothing and swallows flush failures", async (t) => {
  resetGlobals();
  const logged = captureConsoleErrors(t);

  await telemetry.flushSessionTelemetry();
  exportState.flush = "reject";
  await telemetry.flushSessionTelemetry();
  assert.ok(
    logged.some((line) => line.includes("telemetry flush failed")),
    logged.join("\n"),
  );

  exportState.flush = "pending";
  const startedAt = Date.now();
  await telemetry.flushSessionTelemetry(20);
  assert.ok(Date.now() - startedAt < 2_000, "the timeout must bound the flush");
});
