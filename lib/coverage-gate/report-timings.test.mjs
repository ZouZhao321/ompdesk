import assert from "node:assert/strict";
import test from "node:test";
import { renderReport } from "./report.ts";

function sampleInput(overrides = {}) {
  return {
    baseRef: "origin/main",
    mergeBase: "0123456789abcdef0123456789abcdef01234567",
    changedFiles: [],
    coverage: new Map(),
    totals: { linesFound: 100, linesHit: 60, functionsFound: 20, functionsHit: 15 },
    droppedRecords: 0,
    duplicateRecords: 0,
    managedFileCount: 4,
    missingManagedFiles: [],
    findings: [],
    ...overrides,
  };
}

test("耗时段给出本次测试运行、基准运行与分析三段", () => {
  const text = renderReport(
    sampleInput({
      timings: { testMs: 30_000, baseMs: 36_000, baseSkipped: false, analysisMs: 1_500 },
    }),
  );

  assert.match(text, /^耗时$/m);
  assert.match(text, /本次测试运行 30\.0 秒/);
  assert.match(text, /基准运行 36\.0 秒/);
  assert.match(text, /分析 1\.5 秒（不含基准运行）/);
  assert.match(text, /门禁合计 67\.5 秒，预算 180\.0 秒/);
  assert.doesNotMatch(text, /超出预算/);
});

test("基准跳过时写明原因，合计只算实际发生的两段", () => {
  const text = renderReport(
    sampleInput({
      timings: { testMs: 30_000, baseMs: 0, baseSkipped: true, analysisMs: 1_000 },
    }),
  );

  assert.match(text, /基准运行 —（本次没有需要比对的改动文件，跳过）/);
  assert.match(text, /门禁合计 31\.0 秒/);
});

test("超过预算时单独给出超出量", () => {
  const text = renderReport(
    sampleInput({
      timings: { testMs: 200_000, baseMs: 0, baseSkipped: true, analysisMs: 1_500 },
    }),
  );

  assert.match(text, /门禁合计 201\.5 秒，预算 180\.0 秒/);
  assert.match(text, /超出预算 21\.5 秒/);
});
