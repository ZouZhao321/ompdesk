import assert from "node:assert/strict";
import test from "node:test";
import { renderReport } from "../report.ts";
import { ruleNewFiles } from "./rule-new-files.ts";

const TOTALS = { linesFound: 0, linesHit: 0, functionsFound: 0, functionsHit: 0 };

/** 一条产物记录；只填规则一关心的字段。 */
function record(path, functionsFound, functionsHit, linesFound = 10, linesHit = 6) {
  return { path, linesFound, linesHit, functionsFound, functionsHit };
}

function evaluate(changedFiles, records) {
  return ruleNewFiles.evaluate({
    changedFiles,
    coverage: new Map(records.map((file) => [file.path, file])),
    totals: TOTALS,
    managedFiles: changedFiles.map((file) => file.path),
  });
}

test("新增文件里的函数全部被调用时通过", () => {
  const findings = evaluate(
    [{ path: "lib/new.ts", status: "added" }],
    [record("lib/new.ts", 3, 3)],
  );

  assert.deepEqual(findings, []);
});

test("新增文件存在未被调用的函数时失败，五项齐全", () => {
  const findings = evaluate(
    [{ path: "lib/new.ts", status: "added" }],
    [record("lib/new.ts", 3, 2)],
  );

  assert.equal(findings.length, 1);
  const [finding] = findings;
  assert.equal(finding.rule, "rule-1");
  assert.equal(finding.file, "lib/new.ts");
  assert.match(finding.numbers, /被调用 2 \/ 总数 3/);
  assert.match(finding.reason, /函数未被任何测试调用/);
  assert.match(finding.fix, /lib\/new\.ts/);
  for (const value of Object.values(finding)) {
    assert.ok(typeof value === "string" && value.length > 0, "五项都不能为空");
  }
});

test("零函数的新增文件不判失败，报告里标注不适用", () => {
  const changedFiles = [{ path: "lib/types.ts", status: "added" }];

  assert.deepEqual(evaluate(changedFiles, [record("lib/types.ts", 0, 0, 4, 0)]), []);

  const report = renderReport({
    baseRef: "origin/main",
    mergeBase: "0123456789abcdef0123456789abcdef01234567",
    changedFiles,
    coverage: new Map([["lib/types.ts", record("lib/types.ts", 0, 0, 4, 0)]]),
    totals: TOTALS,
    droppedRecords: 0,
    duplicateRecords: 0,
    managedFileCount: 1,
    missingManagedFiles: [],
    findings: [],
  });

  assert.match(report, /新增 {2}lib\/types\.ts · 行 0\/4（0\.00%） · 函数 0\/0（—） · 规则一不适用（零函数）/);
});

test("改动文件不在覆盖率产物里时报「文件未被任何测试加载」", () => {
  const findings = evaluate([{ path: "lib/new.ts", status: "added" }], []);

  assert.equal(findings.length, 1);
  assert.match(findings[0].reason, /文件未被任何测试加载/);
  assert.doesNotMatch(findings[0].reason, /函数未被任何测试调用/);
  assert.match(findings[0].numbers, /产物记录 0 条/);
});

test("未加载与函数未调用分开报：未加载的改动文件不报函数未调用", () => {
  const findings = evaluate(
    [
      { path: "lib/modified.ts", status: "modified" },
      { path: "lib/added.ts", status: "added" },
    ],
    [record("lib/added.ts", 2, 1)],
  );

  assert.equal(findings.length, 2);
  assert.equal(findings[0].file, "lib/modified.ts");
  assert.match(findings[0].reason, /文件未被任何测试加载/);
  assert.equal(findings[1].file, "lib/added.ts");
  assert.match(findings[1].reason, /函数未被任何测试调用/);
});

test("改名后的文件按改动文件处理，不按新增判定", () => {
  const changedFiles = [
    { path: "lib/moved.ts", status: "renamed", previousPath: "lib/old.ts" },
  ];

  assert.deepEqual(evaluate(changedFiles, [record("lib/moved.ts", 5, 2)]), []);

  const findings = evaluate(changedFiles, []);
  assert.equal(findings.length, 1);
  assert.match(findings[0].reason, /文件未被任何测试加载/);
});

test("修改过的文件里函数没被全调用不触发本规则", () => {
  assert.deepEqual(
    evaluate([{ path: "lib/modified.ts", status: "modified" }], [record("lib/modified.ts", 4, 1)]),
    [],
  );
});
