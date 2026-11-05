import assert from "node:assert/strict";
import test from "node:test";
import { buildFunctionDelta, functionDeltaRule } from "./rule-function-delta.ts";

const MERGE_BASE = "0123456789abcdef0123456789abcdef01234567";
const BASE_FUNCTIONS = Array.from({ length: 15 }, (_, index) => `base${index + 1}`);
const ADDED_FUNCTION = "added1";

function source(names) {
  return names.map((name) => `export function ${name}() {}`).join("\n");
}

function metrics(path, hit, found) {
  return { path, linesFound: 0, linesHit: 0, functionsFound: found, functionsHit: hit };
}

function baseCoverageOf(hit, found) {
  return {
    ok: true,
    coverage: new Map([["lib/a.ts", metrics("lib/a.ts", hit, found)]]),
    durationMs: 36_000,
    worktreePath: "/repo/.tmp/coverage-gate-base/base",
  };
}

function buildDelta({
  baseSource = source(BASE_FUNCTIONS),
  headSource = source(BASE_FUNCTIONS),
  baseHit = 6,
  baseFound = 15,
  headHit = 6,
  headFound = 15,
  changedFiles = [{ path: "lib/a.ts", status: "modified" }],
  baseCoverage = baseCoverageOf(baseHit, baseFound),
  headPath = "lib/a.ts",
  sources,
} = {}) {
  return buildFunctionDelta({
    changedFiles,
    coverage: new Map([[headPath, metrics(headPath, headHit, headFound)]]),
    baseCoverage,
    mergeBase: MERGE_BASE,
    sources: sources ?? new Map([[headPath, { base: baseSource, head: headSource }]]),
  });
}

function evaluate(functionDelta, changedFiles = [{ path: "lib/a.ts", status: "modified" }]) {
  return functionDeltaRule.evaluate({
    changedFiles,
    coverage: new Map(),
    totals: { linesFound: 0, linesHit: 0, functionsFound: 0, functionsHit: 0 },
    managedFiles: [],
    functionDelta,
  });
}

test("新增函数被调用数同步增加时通过", () => {
  const headSource = source([...BASE_FUNCTIONS, ADDED_FUNCTION]);
  const delta = buildDelta({ headSource, headHit: 7, headFound: 16 });

  assert.deepEqual(delta.rows[0].added, [ADDED_FUNCTION]);
  assert.deepEqual(evaluate(delta), []);
});

test("只加函数不加命中时失败，输出前后对照", () => {
  const headSource = source([...BASE_FUNCTIONS, ADDED_FUNCTION]);
  const findings = evaluate(buildDelta({ headSource, headHit: 6, headFound: 16 }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "rule-2");
  assert.equal(findings[0].file, "lib/a.ts");
  assert.equal(
    findings[0].numbers,
    "改动前 6/15，改动后 6/16，新增 1 个函数，被调用数增加 0",
  );
  assert.match(findings[0].reason, /新增函数的被调用数没有同步增加/);
  assert.match(findings[0].reason, /added1/);
  assert.match(findings[0].fix, /补测试/);
});

test("函数总数减少时失败", () => {
  const headSource = source(BASE_FUNCTIONS.slice(1));
  const findings = evaluate(buildDelta({ headSource, headFound: 14 }));

  assert.equal(findings.length, 1);
  assert.match(findings[0].numbers, /函数总数减少 1/);
  assert.match(findings[0].numbers, /改动前 6\/15，改动后 6\/14/);
  assert.match(findings[0].reason, /函数总数减少/);
});

test("删除函数同时新增函数、总数不变时，判为疑似替换并转人工豁免", () => {
  const headSource = source([...BASE_FUNCTIONS.slice(1), ADDED_FUNCTION]);
  const delta = buildDelta({ headSource, headFound: 15 });

  assert.deepEqual(evaluate(delta), []);
  assert.match(delta.rows[0].exemptReason, /疑似替换/);
  assert.equal(delta.notes[0].label, "疑似替换");
});

test("删除函数同时新增函数、总数减少时，两条判定分别给出", () => {
  const headSource = source([...BASE_FUNCTIONS.slice(1), ADDED_FUNCTION]);
  const findings = evaluate(buildDelta({ headSource, headFound: 14 }));

  assert.equal(findings.length, 2);
  assert.match(findings[0].numbers, /函数总数减少/);
  assert.match(findings[1].numbers, /新增 1 个函数，被调用数增加 0/);
});

test("总数减少但结构里没有删除函数时，指明计数与结构不一致", () => {
  const findings = evaluate(buildDelta({ headFound: 14, headHit: 6 }));

  assert.equal(findings.length, 1);
  assert.match(findings[0].reason, /覆盖率计数与结构不一致/);
  assert.match(findings[0].fix, /流水线问题/);
});

test("新增文件不参与本规则", () => {
  const delta = buildDelta({
    changedFiles: [{ path: "lib/new.ts", status: "added" }],
    headPath: "lib/new.ts",
  });

  assert.deepEqual(delta.rows, []);
  assert.deepEqual(evaluate(delta), []);
});

test("改名文件用改名前的路径取基准", () => {
  const delta = buildDelta({
    changedFiles: [{ path: "lib/b.ts", status: "renamed", previousPath: "lib/a.ts" }],
    headPath: "lib/b.ts",
    headHit: 6,
    headFound: 15,
  });

  assert.equal(delta.rows[0].baseHit, 6);
  assert.equal(delta.rows[0].baseFound, 15);
  assert.deepEqual(evaluate(delta), []);
});

test("基准运行失败时报告流水线问题，不静默通过", () => {
  const findings = evaluate(buildDelta({
    baseCoverage: {
      ok: false,
      detail: "分叉点 0123456 的测试运行失败：1 test failed",
      durationMs: 12_000,
    },
  }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, "（基准覆盖率）");
  assert.match(findings[0].reason, /流水线问题/);
  assert.match(findings[0].reason, /测试运行失败/);
  assert.match(findings[0].fix, /重跑/);
});

test("基准数据未接入时同样报流水线问题", () => {
  const findings = evaluate(undefined);

  assert.equal(findings.length, 1);
  assert.match(findings[0].reason, /流水线问题/);
});

test("分叉点版本读不到时按流水线问题报出文件名", () => {
  const findings = evaluate(buildDelta({
    sources: new Map([["lib/a.ts", { base: null, head: source(BASE_FUNCTIONS) }]]),
  }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, "lib/a.ts");
  assert.match(findings[0].reason, /分叉点版本的文件正文读取失败/);
});
