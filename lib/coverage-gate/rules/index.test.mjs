import assert from "node:assert/strict";
import test from "node:test";
import { RULES, evaluateRules } from "./index.ts";

const INPUT = {
  changedFiles: [],
  coverage: new Map(),
  totals: { linesFound: 0, linesHit: 0, functionsFound: 0, functionsHit: 0 },
  managedFiles: [],
};

test("本票据的注册表为空，只报告不判定", () => {
  assert.equal(RULES.length, 0);
});

test("evaluateRules 按顺序汇总各条规则的结果", () => {
  const first = {
    rule: "R1",
    file: "lib/a.ts",
    numbers: "函数 0/1",
    reason: "函数未被调用",
    fix: "补测试",
  };
  const second = {
    rule: "R2",
    file: "lib/b.ts",
    numbers: "6/15 → 6/16",
    reason: "被调用数没有增长",
    fix: "为新函数补测试",
  };
  const rules = [
    { id: "R1", title: "第一条", evaluate: () => [first] },
    { id: "R2", title: "第二条", evaluate: () => [second] },
  ];

  assert.deepEqual(evaluateRules(INPUT, rules), [first, second]);
});

test("没有规则时不产生判定结果", () => {
  assert.deepEqual(evaluateRules(INPUT), []);
});
