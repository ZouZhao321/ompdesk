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
      [
        "lib/hit.ts",
        {
          path: "lib/hit.ts",
          linesFound: 20,
          linesHit: 12,
          functionsFound: 4,
          functionsHit: 3,
        },
      ],
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

  assert.match(text, /^覆盖率门禁（只报告，不阻断合并）$/m);
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
  const text = renderReport(
    sampleInput({
      findings: [
        {
          rule: "R1",
          file: "lib/new.ts",
          numbers: "函数 0/1",
          reason: "新增文件里的函数未被任何测试调用",
          fix: "为新函数补测试",
        },
      ],
    }),
  );

  assert.match(text, /规则判定：1 条/);
  assert.match(text, /\[R1\] lib\/new\.ts/);
  assert.match(text, /数字：函数 0\/1/);
  assert.match(text, /理由：新增文件里的函数未被任何测试调用/);
  assert.match(text, /修复：为新函数补测试/);
});

test("报告结尾声明只报告不阻断", () => {
  const text = renderReport(sampleInput());

  assert.match(text, /本步骤只报告，不阻断合并；退出码固定为 0。/);
});
