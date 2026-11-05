import assert from "node:assert/strict";
import test from "node:test";
import { renderReport } from "./report.ts";

function sampleInput(overrides = {}) {
  return {
    baseRef: "origin/main",
    mergeBase: "0123456789abcdef0123456789abcdef01234567",
    changedFiles: [
      { path: "lib/hit.ts", status: "modified" },
      { path: "lib/new.ts", status: "added" },
      { path: "lib/moved.ts", status: "renamed", previousPath: "lib/old.ts" },
    ],
    coverage: new Map([
      ["lib/hit.ts", {
        path: "lib/hit.ts",
        linesFound: 20,
        linesHit: 12,
        functionsFound: 4,
        functionsHit: 3,
      }],
    ]),
    totals: { linesFound: 200, linesHit: 150, functionsFound: 40, functionsHit: 31 },
    droppedRecords: 4,
    duplicateRecords: 2,
    managedFileCount: 10,
    missingManagedFiles: ["app/a.ts", "app/b.ts", "app/c.ts", "app/d.ts"],
    findings: [],
    ...overrides,
  };
}

test("报告列出每个改动文件的行与函数指标", () => {
  const text = renderReport(sampleInput());

  assert.match(text, /^覆盖率门禁$/m);
  assert.match(text, /基准 origin\/main，分叉点 0123456/);
  assert.match(text, /改动文件：3 个受管源文件/);
  assert.match(text, /修改 {2}lib\/hit\.ts · 行 12\/20（60\.00%） · 函数 3\/4（75\.00%）/);
  assert.match(text, /新增 {2}lib\/new\.ts · 行 0\/0（未加载） · 函数 0\/0（未加载）/);
  assert.match(text, /改名 {2}lib\/moved\.ts ← lib\/old\.ts/);
});

test("仓库内合计给出分子分母与加权百分比", () => {
  const text = renderReport(sampleInput());

  assert.match(text, /仓库内合计（加权）/);
  assert.match(text, /行覆盖 150\/200（75\.00%）/);
  assert.match(text, /函数覆盖 31\/40（77\.50%）/);
});

test("报告说明剔除与去重的记录条数", () => {
  const text = renderReport(sampleInput());

  assert.match(text, /仓库外或越界记录剔除 4 条/);
  assert.match(text, /重复路径去重忽略 2 条/);
});

test("缺席的受管源文件给出数量与前三例", () => {
  const text = renderReport(sampleInput());

  assert.match(text, /报告缺席的受管源文件：4\/10/);
  assert.match(text, /^ {2}app\/a\.ts$/m);
  assert.match(text, /^ {2}app\/b\.ts$/m);
  assert.match(text, /^ {2}app\/c\.ts$/m);
  assert.doesNotMatch(text, /app\/d\.ts/);
  assert.match(text, /另有 1 个。/);
});

test("没有缺席文件时不列例子", () => {
  const text = renderReport(sampleInput({ missingManagedFiles: [] }));

  assert.match(text, /报告缺席的受管源文件：0\/10/);
  assert.doesNotMatch(text, /另有/);
});

test("规则结果按五项渲染", () => {
  const text = renderReport(sampleInput({
    findings: [{
      rule: "R1",
      file: "lib/new.ts",
      numbers: "函数 0/1",
      reason: "新增文件里的函数未被任何测试调用",
      fix: "为新函数补测试",
    }],
  }));

  assert.match(text, /规则判定：1 条/);
  assert.match(text, /\[R1\] lib\/new\.ts/);
  assert.match(text, /数字：函数 0\/1/);
  assert.match(text, /理由：新增文件里的函数未被任何测试调用/);
  assert.match(text, /修复：为新函数补测试/);
});

test("函数增量段给出每个改动文件的改动前与改动后数字", () => {
  const text = renderReport(sampleInput({
    functionDelta: {
      mergeBase: "0123456789abcdef0123456789abcdef01234567",
      baseCoverage: { ok: true, coverage: new Map(), durationMs: 36_000, worktreePath: "/repo/.tmp/base" },
      rows: [{
        file: "lib/hit.ts",
        baseHit: 3,
        baseFound: 4,
        headHit: 3,
        headFound: 5,
        added: ["extra"],
        removed: [],
        addedReExports: [],
        removedReExports: [],
        addedExported: [],
        baseSourceMissing: false,
        headSourceMissing: false,
      }],
      notes: [],
      lineFallbacks: [],
    },
  }));

  assert.match(text, /函数增量（相对分叉点 0123456）/);
  assert.match(text, /基准覆盖率现场生成，耗时 36\.0 秒/);
  assert.match(
    text,
    /lib\/hit\.ts · 改动前 3\/4 · 改动后 3\/5 · 新增 1 · 删除 0 · 被调用数 \+0/,
  );
});

test("基准不可用时函数增量段写明流水线问题", () => {
  const text = renderReport(sampleInput({
    functionDelta: {
      mergeBase: "0123456789abcdef0123456789abcdef01234567",
      baseCoverage: {
        ok: false,
        detail: "分叉点 0123456 的测试运行失败：1 test failed",
        durationMs: 12_000,
      },
      rows: [],
      notes: [],
      lineFallbacks: [],
    },
  }));

  assert.match(text, /基准覆盖率不可用（流水线问题）：分叉点 0123456 的测试运行失败/);
});

test("报告结尾说明退出码与判定结果一致", () => {
  const passed = renderReport(sampleInput());
  const failed = renderReport(sampleInput({
    findings: [{
      rule: "rule-2",
      file: "lib/hit.ts",
      numbers: "改动前 3/4，改动后 3/4，新增 1 个函数，被调用数增加 0",
      reason: "新增函数的被调用数没有同步增加",
      fix: "为新增函数补测试",
    }],
  }));

  assert.match(passed, /本次没有判定结果，退出码为 0。/);
  assert.match(failed, /本次 1 条判定未通过，退出码非零。/);
  assert.match(failed, /^覆盖率门禁（本次有判定未通过）$/m);
});
