import assert from "node:assert/strict";
import test from "node:test";
import { dropPreExisting, errorSignature, parseAddedRanges } from "./lint-diff.ts";

test("从统一差异里读出新增行区间，纯删除的段不算", () => {
  const diff = ["diff --git a/a.ts b/a.ts", "@@ -1 +1,3 @@", "@@ -10,2 +12,0 @@", "@@ -20,0 +21,2 @@"].join("\n");

  assert.deepEqual(parseAddedRanges(diff), [
    [1, 3],
    [21, 22],
  ]);
});

test("单独一行的改动段按一行计算", () => {
  assert.deepEqual(parseAddedRanges("@@ -621,19 +652,26 @@ export function useAgentSession("), [[652, 677]]);
});

test("error 签名忽略代码片段与缩进差异", () => {
  const base = {
    ruleId: "react-hooks/preserve-manual-memoization",
    severity: 2,
    message:
      "Compilation Skipped: Existing memoization could not be preserved\n\nReact Compiler has skipped optimizing this component.\n\nC:\\repo\\hooks\\useAgentSession.ts:621:45\n  619 |   }, []);\n> 621 |   const x = useCallback(",
  };
  const reformatted = {
    ...base,
    message: base.message.replace(
      "C:\\repo\\hooks\\useAgentSession.ts:621:45",
      "C:\\repo\\hooks\\useAgentSession.ts:653:5",
    ),
  };

  assert.equal(errorSignature(base), errorSignature(reformatted));
  assert.equal(errorSignature(base).startsWith("react-hooks/preserve-manual-memoization"), true);
  assert.equal(errorSignature(base).includes("C:\\repo"), false);
});

test("不同规则或不同正文的 error 签名不同", () => {
  const first = { ruleId: "react-hooks/rules-of-hooks", severity: 2, message: "A" };
  const second = { ruleId: "react-hooks/rules-of-hooks", severity: 2, message: "B" };
  const third = { ruleId: "no-console", severity: 2, message: "A" };

  assert.notEqual(errorSignature(first), errorSignature(second));
  assert.notEqual(errorSignature(first), errorSignature(third));
});

test("按条数扣除基准已有的同名 error，多出来的才算新增", () => {
  const signature = { ruleId: "react-hooks/preserve-manual-memoization", severity: 2, message: "Same body" };
  const baseline = [{ ...signature }, { ...signature }];

  const kept = dropPreExisting(
    [
      { ...signature, line: 653 },
      { ...signature, line: 900 },
      { ...signature, line: 1972 },
      { ruleId: "no-console", severity: 2, message: "New one" },
    ],
    baseline,
  );

  assert.equal(kept.length, 2);
  assert.deepEqual(
    kept.map((message) => message.line),
    [1972, undefined],
  );
});

test("基准为空时全部保留", () => {
  const kept = dropPreExisting([{ ruleId: "no-console", severity: 2, message: "A", line: 1 }], []);

  assert.equal(kept.length, 1);
});
