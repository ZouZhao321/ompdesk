import assert from "node:assert/strict";
import test from "node:test";

const { startMemoryMonitor, stopMemoryMonitor, MEMORY_SAMPLE_INTERVAL_ENV } = await import("./memory-monitor.ts");

test("uses the process timers when no clock is injected", (t) => {
  stopMemoryMonitor();
  t.after(() => stopMemoryMonitor());

  const samples = [];
  const started = startMemoryMonitor({
    intervalMs: 60_000,
    emit: (sample, intervalMs) => samples.push({ sample, intervalMs }),
  });

  assert.equal(started, true);
  assert.equal(samples.length, 1);
  assert.equal(samples[0].intervalMs, 60_000);
  assert.ok(samples[0].sample.rss > 0);
  assert.equal(startMemoryMonitor({ intervalMs: 60_000, emit: () => {} }), false, "only one monitor per process");

  stopMemoryMonitor();
  assert.equal(
    startMemoryMonitor({ env: { [MEMORY_SAMPLE_INTERVAL_ENV]: "0" }, emit: () => assert.fail("must not sample") }),
    false,
    "the off switch still applies after a stop",
  );
});
