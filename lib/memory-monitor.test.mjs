import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const {
  DEFAULT_MEMORY_SAMPLE_INTERVAL_MS,
  MEMORY_SAMPLE_INTERVAL_ENV,
  MIN_MEMORY_SAMPLE_INTERVAL_MS,
  readMemorySample,
  resolveMemorySampleIntervalMs,
  startMemoryMonitor,
  stopMemoryMonitor,
} = await import("./memory-monitor.ts");

/** 手动触发的定时器：不依赖真实时间，采样次数可以精确断言。 */
function fakeClock() {
  const timers = [];
  return {
    timers,
    setInterval(callback, intervalMs) {
      const handle = { callback, intervalMs, cleared: false };
      timers.push(handle);
      return handle;
    },
    clearInterval(handle) {
      handle.cleared = true;
    },
  };
}

test("readMemorySample maps usage fields, rounds, and defaults arrayBuffers", () => {
  assert.deepEqual(
    readMemorySample(
      { rss: 100.4, heapTotal: 60.6, heapUsed: 40.2, external: 5.5, arrayBuffers: 2.2 },
      12.6,
    ),
    { rss: 100, heapTotal: 61, heapUsed: 40, external: 6, arrayBuffers: 2, uptimeSec: 13 },
  );

  assert.equal(
    readMemorySample({ rss: 1, heapTotal: 1, heapUsed: 1, external: 1 }, 0).arrayBuffers,
    0,
  );
});

test("readMemorySample reports the current process", () => {
  const sample = readMemorySample();
  assert.ok(sample.rss > 0, "rss");
  assert.ok(sample.heapTotal > 0, "heapTotal");
  assert.ok(sample.heapUsed >= 0, "heapUsed");
  assert.ok(sample.uptimeSec >= 0, "uptimeSec");
});

test("resolveMemorySampleIntervalMs reads the environment, with 0 as the off switch", () => {
  const cases = [
    [undefined, DEFAULT_MEMORY_SAMPLE_INTERVAL_MS],
    ["", DEFAULT_MEMORY_SAMPLE_INTERVAL_MS],
    ["  ", DEFAULT_MEMORY_SAMPLE_INTERVAL_MS],
    ["45000", 45000],
    [" 45000 ", 45000],
    [String(MIN_MEMORY_SAMPLE_INTERVAL_MS), MIN_MEMORY_SAMPLE_INTERVAL_MS],
    ["0", undefined],
    ["0.0", undefined],
    ["-1000", DEFAULT_MEMORY_SAMPLE_INTERVAL_MS],
    ["999", DEFAULT_MEMORY_SAMPLE_INTERVAL_MS],
    ["abc", DEFAULT_MEMORY_SAMPLE_INTERVAL_MS],
    ["Infinity", DEFAULT_MEMORY_SAMPLE_INTERVAL_MS],
  ];

  for (const [raw, expected] of cases) {
    const env = raw === undefined ? {} : { [MEMORY_SAMPLE_INTERVAL_ENV]: raw };
    assert.equal(resolveMemorySampleIntervalMs(env), expected, `env=${JSON.stringify(raw)}`);
  }
});

test("startMemoryMonitor samples immediately, repeats on the interval, and stops", (t) => {
  t.after(() => stopMemoryMonitor());
  const clock = fakeClock();
  const samples = [];

  const started = startMemoryMonitor({
    intervalMs: 5000,
    clock,
    emit: (sample, intervalMs) => samples.push({ sample, intervalMs }),
  });

  assert.equal(started, true);
  assert.equal(clock.timers.length, 1);
  assert.equal(clock.timers[0].intervalMs, 5000);
  assert.equal(samples.length, 1, "baseline sample at start");
  assert.equal(samples[0].intervalMs, 5000);
  assert.ok(samples[0].sample.rss > 0);

  clock.timers[0].callback();
  assert.equal(samples.length, 2);

  assert.equal(
    startMemoryMonitor({ intervalMs: 5000, clock, emit: () => {} }),
    false,
    "a second start is a no-op",
  );
  assert.equal(clock.timers.length, 1);

  stopMemoryMonitor();
  assert.equal(clock.timers[0].cleared, true);
  assert.equal(
    startMemoryMonitor({ intervalMs: 5000, clock, emit: () => {} }),
    true,
    "starting again after stop installs a fresh timer",
  );
});

test("startMemoryMonitor does nothing when the interval is switched off", () => {
  const clock = fakeClock();
  let emitted = 0;
  const started = startMemoryMonitor({
    env: { [MEMORY_SAMPLE_INTERVAL_ENV]: "0" },
    clock,
    emit: () => {
      emitted += 1;
    },
  });

  assert.equal(started, false);
  assert.equal(clock.timers.length, 0);
  assert.equal(emitted, 0);
});

/**
 * 打包后的进程只在第一条记录触发懒启动时才开始采样，`configureLogging` 从不运行。
 * 探针在隔离的 HOME 里走这条路径，确认记录确实写进了默认日志目录。
 */
test("the lazy bootstrap path writes process.memory to the default log directory", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-memory-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const loggingUrl = pathToFileURL(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "logging.ts"),
  ).href;
  const probe = path.join(root, "probe.mjs");
  fs.writeFileSync(
    probe,
    `const { logEvent, flushLogs } = await import(${JSON.stringify(loggingUrl)});\n` +
      `logEvent("info", "system", "probe.record");\n` +
      `flushLogs();\n`,
  );

  execFileSync(process.execPath, [probe], {
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      XDG_STATE_HOME: path.join(root, "xdg-state"),
      XDG_DATA_HOME: path.join(root, "xdg-data"),
      XDG_CACHE_HOME: path.join(root, "xdg-cache"),
      PI_CONFIG_DIR: ".omp",
      OMPDESK_MEMORY_SAMPLE_MS: "",
    },
    encoding: "utf8",
    timeout: 30_000,
  });

  const records = [];
  for (const entry of fs.readdirSync(path.join(root, ".omp"), { recursive: true })) {
    const file = path.join(root, ".omp", String(entry));
    if (!file.endsWith(".log") || !fs.statSync(file).isFile()) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      if (line.trim()) records.push(JSON.parse(line));
    }
  }

  const sample = records.find((record) => record.message === "process.memory");
  assert.ok(sample, "process.memory record");
  assert.equal(sample.source, "ompdesk");
  assert.equal(sample.subsystem, "process");
  assert.equal(sample.level, "debug");
  assert.equal(sample.intervalMs, DEFAULT_MEMORY_SAMPLE_INTERVAL_MS);
  assert.ok(sample.rss > 0, "rss");
  assert.equal(typeof sample.uptimeSec, "number");
});
