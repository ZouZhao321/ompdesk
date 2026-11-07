import assert from "node:assert/strict";
import test from "node:test";
import { buildFunctionDelta, functionDeltaRule } from "./rule-function-delta.ts";
import { ruleNewFiles } from "./rule-new-files.ts";

const MERGE_BASE = "0123456789abcdef0123456789abcdef01234567";

/** 每个名字一个带函数体的导出函数。 */
function source(names) {
  return names.map((name) => `export function ${name}() {}`).join("\n");
}

function metrics(path, functionsHit, functionsFound, linesHit = 0, linesFound = 0) {
  return { path, linesHit, linesFound, functionsHit, functionsFound };
}

function baseCoverageOf(entries, lines = {}) {
  return {
    ok: true,
    coverage: new Map(
      entries.map(([path, hit, found]) => [
        path,
        metrics(path, hit, found, lines[path]?.[0] ?? 0, lines[path]?.[1] ?? 0),
      ]),
    ),
    durationMs: 36_000,
    worktreePath: "/repo/.tmp/coverage-gate-base/base",
  };
}

/** 组装规则二的数据：改动清单、两版正文、两侧覆盖率与已删除文件的正文。 */
function buildDelta({
  changedFiles,
  sources,
  deletedSources = new Map(),
  baseCoverage,
  coverage,
  managedFiles,
  baseLines = {},
  headLines = {},
}) {
  const head = new Map(sources);
  return buildFunctionDelta({
    changedFiles,
    coverage: new Map(
      coverage.map(([path, hit, found]) => [
        path,
        metrics(path, hit, found, headLines[path]?.[0] ?? 0, headLines[path]?.[1] ?? 0),
      ]),
    ),
    baseCoverage: baseCoverageOf(baseCoverage, baseLines),
    mergeBase: MERGE_BASE,
    sources: head,
    managedFiles,
    deletedSources,
  });
}

function ruleInput(delta, changedFiles, coverage, extra = {}) {
  return {
    changedFiles,
    coverage: new Map(coverage.map(([path, hit, found]) => [path, metrics(path, hit, found)])),
    totals: { linesFound: 0, linesHit: 0, functionsFound: 0, functionsHit: 0 },
    managedFiles: [],
    functionDelta: delta,
    ...extra,
  };
}

test("改名文件把旧路径的基准映射到新路径，不判失败", () => {
  const names = ["a", "b", "c"];
  const changedFiles = [{ path: "lib/new.ts", status: "renamed", previousPath: "lib/old.ts" }];
  const delta = buildDelta({
    changedFiles,
    sources: new Map([["lib/new.ts", { base: source(names), head: source(names) }]]),
    baseCoverage: [["lib/old.ts", 2, 3]],
    coverage: [["lib/new.ts", 2, 3]],
    managedFiles: ["lib/new.ts"],
  });

  assert.equal(delta.rows[0].baseFound, 3);
  assert.equal(delta.rows[0].baseHit, 2);
  assert.equal(delta.notes[0].label, "改名");
  assert.match(delta.notes[0].numbers, /基准取改名前的路径/);
  assert.deepEqual(
    functionDeltaRule.evaluate(
      ruleInput(delta, changedFiles, [["lib/new.ts", 2, 3]]),
    ),
    [],
  );
});

test("改名幅度过大未被 git 识别时按新增文件处理，走规则一", () => {
  const names = ["a", "b", "c", "d"];
  const changedFiles = [{ path: "lib/new.ts", status: "added" }];
  const delta = buildDelta({
    changedFiles,
    sources: new Map([["lib/new.ts", { base: null, head: source(names) }]]),
    deletedSources: new Map([["lib/old.ts", source(names)]]),
    baseCoverage: [["lib/old.ts", 4, 4]],
    coverage: [["lib/new.ts", 1, 4]],
    managedFiles: ["lib/new.ts"],
  });

  // 新增文件不产生规则二的行，判定交给规则一。
  assert.deepEqual(delta.rows, []);
  assert.equal(delta.notes[0].label, "改名未识别");
  assert.match(delta.notes[0].reason, /按新增文件处理，走规则一/);

  const input = ruleInput(delta, changedFiles, [["lib/new.ts", 1, 4]]);
  assert.deepEqual(functionDeltaRule.evaluate(input), []);
  const findings = ruleNewFiles.evaluate(input);
  assert.equal(findings.length, 1);
  assert.match(findings[0].reason, /新增文件里有函数未被任何测试调用/);
});

test("一个文件分成多个且函数名完整对应时豁免规则二", () => {
  const changedFiles = [
    { path: "lib/a-part1.ts", status: "added" },
    { path: "lib/a-part2.ts", status: "added" },
  ];
  const delta = buildDelta({
    changedFiles,
    sources: new Map([
      ["lib/a-part1.ts", { base: null, head: source(["a1", "a2", "a3"]) }],
      ["lib/a-part2.ts", { base: null, head: source(["a4", "a5", "a6"]) }],
    ]),
    deletedSources: new Map([["lib/a.ts", source(["a1", "a2", "a3", "a4", "a5", "a6"])]]),
    baseCoverage: [["lib/a.ts", 6, 6]],
    coverage: [
      ["lib/a-part1.ts", 3, 3],
      ["lib/a-part2.ts", 3, 3],
    ],
    managedFiles: ["lib/a-part1.ts", "lib/a-part2.ts"],
  });

  assert.equal(delta.notes[0].label, "文件分成多个");
  assert.match(delta.notes[0].numbers, /函数名集合完整对应/);
  assert.deepEqual(delta.lineFallbacks, []);
  assert.deepEqual(
    functionDeltaRule.evaluate(
      ruleInput(delta, changedFiles, [["lib/a-part1.ts", 3, 3], ["lib/a-part2.ts", 3, 3]]),
    ),
    [],
  );
});

test("分成多个但函数名对应不完整时豁免规则二，退回行覆盖增量", () => {
  const changedFiles = [
    { path: "lib/a-part1.ts", status: "added" },
    { path: "lib/a-part2.ts", status: "added" },
  ];
  const delta = buildDelta({
    changedFiles,
    sources: new Map([
      ["lib/a-part1.ts", { base: null, head: source(["a1", "a2", "a3"]) }],
      // a6 在拆分后消失。
      ["lib/a-part2.ts", { base: null, head: source(["a4", "a5"]) }],
    ]),
    deletedSources: new Map([["lib/a.ts", source(["a1", "a2", "a3", "a4", "a5", "a6"])]]),
    baseCoverage: [["lib/a.ts", 6, 6]],
    baseLines: { "lib/a.ts": [10, 10] },
    coverage: [
      ["lib/a-part1.ts", 3, 3],
      ["lib/a-part2.ts", 2, 2],
    ],
    headLines: {
      "lib/a-part1.ts": [5, 5],
      "lib/a-part2.ts": [4, 4],
    },
    managedFiles: ["lib/a-part1.ts", "lib/a-part2.ts"],
  });

  assert.equal(delta.notes[0].label, "文件分成多个");
  assert.match(delta.notes[0].numbers, /未对应的旧函数 1 个/);
  assert.match(delta.notes[0].reason, /退回行覆盖增量/);
  assert.equal(delta.lineFallbacks.length, 1);
  // 行覆盖没有退步：命中与总数同步减少，判定通过。
  assert.deepEqual(
    functionDeltaRule.evaluate(
      ruleInput(delta, changedFiles, [["lib/a-part1.ts", 3, 3], ["lib/a-part2.ts", 2, 2]]),
    ),
    [],
  );
});

test("分成多个、对应不完整且行覆盖没有跟上时失败", () => {
  const changedFiles = [
    { path: "lib/a-part1.ts", status: "added" },
    { path: "lib/a-part2.ts", status: "added" },
  ];
  const delta = buildDelta({
    changedFiles,
    sources: new Map([
      ["lib/a-part1.ts", { base: null, head: source(["a1", "a2", "a3"]) }],
      ["lib/a-part2.ts", { base: null, head: source(["a4", "a5"]) }],
    ]),
    deletedSources: new Map([["lib/a.ts", source(["a1", "a2", "a3", "a4", "a5", "a6"])]]),
    baseCoverage: [["lib/a.ts", 6, 6]],
    baseLines: { "lib/a.ts": [10, 10] },
    coverage: [
      ["lib/a-part1.ts", 3, 3],
      ["lib/a-part2.ts", 2, 2],
    ],
    headLines: {
      "lib/a-part1.ts": [4, 5],
      "lib/a-part2.ts": [4, 4],
    },
    managedFiles: ["lib/a-part1.ts", "lib/a-part2.ts"],
  });

  const findings = functionDeltaRule.evaluate(
    ruleInput(delta, changedFiles, [["lib/a-part1.ts", 3, 3], ["lib/a-part2.ts", 2, 2]]),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "rule-2");
  assert.match(findings[0].numbers, /行 改动前 10\/10，改动后 8\/9/);
  assert.match(findings[0].reason, /函数名集合对应不完整/);
  assert.match(findings[0].reason, /退回行覆盖增量/);
});

test("多个文件合为一个且函数名完整对应时豁免规则二", () => {
  const changedFiles = [{ path: "lib/merged.ts", status: "added" }];
  const delta = buildDelta({
    changedFiles,
    sources: new Map([
      ["lib/merged.ts", { base: null, head: source(["x1", "x2", "y1", "y2"]) }],
    ]),
    deletedSources: new Map([
      ["lib/x.ts", source(["x1", "x2"])],
      ["lib/y.ts", source(["y1", "y2"])],
    ]),
    baseCoverage: [
      ["lib/x.ts", 2, 2],
      ["lib/y.ts", 2, 2],
    ],
    coverage: [["lib/merged.ts", 4, 4]],
    managedFiles: ["lib/merged.ts"],
  });

  assert.equal(delta.notes[0].label, "多个文件合为一个");
  assert.match(delta.notes[0].numbers, /函数名集合完整对应/);
  assert.deepEqual(
    functionDeltaRule.evaluate(ruleInput(delta, changedFiles, [["lib/merged.ts", 4, 4]])),
    [],
  );
});

test("删除旧函数后新增函数、净增量为零时输出疑似替换并转人工豁免", () => {
  const changedFiles = [{ path: "lib/a.ts", status: "modified" }];
  const delta = buildDelta({
    changedFiles,
    sources: new Map([
      ["lib/a.ts", { base: source(["old1", "old2", "keep"]), head: source(["new1", "new2", "keep"]) }],
    ]),
    baseCoverage: [["lib/a.ts", 3, 3]],
    coverage: [["lib/a.ts", 3, 3]],
    managedFiles: ["lib/a.ts"],
  });

  assert.equal(delta.notes[0].label, "疑似替换");
  assert.match(delta.notes[0].numbers, /删除 2 个函数，新增 2 个，净增量 0/);
  assert.match(delta.notes[0].fix, /转人工豁免/);
  assert.match(delta.rows[0].exemptReason, /疑似替换/);
  assert.deepEqual(
    functionDeltaRule.evaluate(ruleInput(delta, changedFiles, [["lib/a.ts", 3, 3]])),
    [],
  );
});

test("原文件保留一部分、其余搬到新文件时同样按分成多个豁免", () => {
  const changedFiles = [
    { path: "lib/a.ts", status: "modified" },
    { path: "lib/a-rest.ts", status: "added" },
  ];
  const delta = buildDelta({
    changedFiles,
    sources: new Map([
      ["lib/a.ts", { base: source(["a1", "a2", "a3", "a4"]), head: source(["a1", "a2"]) }],
      ["lib/a-rest.ts", { base: null, head: source(["a3", "a4"]) }],
    ]),
    baseCoverage: [["lib/a.ts", 4, 4]],
    coverage: [
      ["lib/a.ts", 2, 2],
      ["lib/a-rest.ts", 2, 2],
    ],
    managedFiles: ["lib/a.ts", "lib/a-rest.ts"],
  });

  assert.equal(delta.notes[0].label, "文件分成多个");
  assert.match(delta.notes[0].file, /lib\/a\.ts → lib\/a-rest\.ts、lib\/a\.ts/);
  // 函数总数从 4 掉到 2，正常情况下会判「函数总数减少」，这里由结构改造豁免。
  assert.match(delta.rows[0].exemptReason, /文件分成多个/);
  assert.deepEqual(
    functionDeltaRule.evaluate(
      ruleInput(delta, changedFiles, [["lib/a.ts", 2, 2], ["lib/a-rest.ts", 2, 2]]),
    ),
    [],
  );
});

test("新增的对外函数没有被测试文件导入时失败", () => {
  const changedFiles = [{ path: "lib/a.ts", status: "modified" }];
  const delta = buildDelta({
    changedFiles,
    sources: new Map([
      ["lib/a.ts", {
        base: source(["base"]),
        head: `${source(["base", "added1"])}\nfunction helper() {}`,
      }],
    ]),
    baseCoverage: [["lib/a.ts", 1, 1]],
    coverage: [["lib/a.ts", 3, 3]],
    managedFiles: ["lib/a.ts"],
  });

  assert.deepEqual(delta.rows[0].addedExported, ["added1"]);

  const imported = functionDeltaRule.evaluate(ruleInput(delta, changedFiles, [["lib/a.ts", 3, 3]], {
    testImports: new Map([["lib/a.ts", new Set(["added1"])]]),
  }));
  assert.deepEqual(imported, []);

  const missing = functionDeltaRule.evaluate(ruleInput(delta, changedFiles, [["lib/a.ts", 3, 3]], {
    testImports: new Map([["lib/a.ts", new Set(["base"])]]),
  }));
  assert.equal(missing.length, 1);
  assert.equal(missing[0].rule, "rule-2");
  assert.match(missing[0].reason, /没有出现在任何测试文件的导入语句里：added1/);
  // 内部辅助函数不在这条约束里。
  assert.doesNotMatch(missing[0].reason, /helper/);
});
