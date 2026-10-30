import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { FOLLOW_BOTTOM_THRESHOLD_PX, reduceFollow } from "../lib/transcript-follow.ts";

const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("useAgentSession.ts", source, ts.ScriptTarget.Latest, true);

let applyFollowSource = null;
function collect(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "applyFollow"
    && node.initializer && ts.isCallExpression(node.initializer)
    && node.initializer.expression.getText(ast) === "useCallback") {
    applyFollowSource = node.initializer.arguments[0].getText(ast);
  }
  ts.forEachChild(node, collect);
}
collect(ast);

// 执行生产代码里的回调，只剥掉 TypeScript 语法。判定用真实的 reduceFollow，
// 意图窗口与滚动入口是 doubles；滚动回调记下滚动那一刻的意图窗口，清理必须发生
// 在滚动之前，否则这次回底自己的滚动事件会被当成用户驱动。
function harness(intentUntil) {
  const ref = { current: intentUntil };
  const scrolls = [];
  const followStates = [];
  assert.ok(applyFollowSource, "Missing callback: applyFollow");
  const { outputText } = ts.transpileModule(`const callback = ${applyFollowSource};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  });
  const applyFollow = new Function(
    "reduceFollow",
    "userScrollIntentUntilRef",
    "setAutoFollow",
    "scrollToBottom",
    `${outputText}\nreturn callback;`,
  )(
    reduceFollow,
    ref,
    (following) => followStates.push(following),
    (behavior) => scrolls.push({ behavior, intentUntilAtScroll: ref.current }),
  );
  return { applyFollow, scrolls, followStates, ref };
}

test("clears the user scroll intent window before a submitted prompt pulls to the end", () => {
  const { applyFollow, scrolls, followStates, ref } = harness(Date.now() + 1200);

  // 用户在意图窗口里上滚后按回车：回底的滚动是程序化的，不能算成又一次用户上滚，
  // 否则跟随会立刻被判回暂停、视图停在历史中间。
  applyFollow({ type: "submit" });

  assert.deepEqual(scrolls, [{ behavior: "auto", intentUntilAtScroll: 0 }]);
  assert.deepEqual(followStates, [true]);
  assert.equal(ref.current, 0);
});

test("clears the intent window for the jump-to-bottom event too", () => {
  const { applyFollow, scrolls, ref } = harness(Date.now() + 1200);

  applyFollow({ type: "resume" });

  assert.deepEqual(scrolls, [{ behavior: "smooth", intentUntilAtScroll: 0 }]);
  assert.equal(ref.current, 0);
});

test("walks the switch from a jump's pause to a bottom scroll", () => {
  const { applyFollow, scrolls, followStates, ref } = harness(Date.now() + 1200);

  // 跳转停掉跟随，并清掉意图窗口：它自己会带着列表滚一次，这次滚动算不上用户驱动，
  // 落在贴底距离内也不会把刚停掉的跟随打开。
  applyFollow({ type: "pause" });
  assert.equal(ref.current, 0);
  assert.deepEqual(followStates, [false]);
  assert.deepEqual(scrolls, []);

  // 用户贴着底滚回来时恢复跟随，但不是主动回底：不滚动，也不再动意图窗口。
  applyFollow({
    type: "scroll",
    userDriven: true,
    distanceFromBottom: FOLLOW_BOTTOM_THRESHOLD_PX,
  });
  assert.equal(ref.current, 0);
  assert.deepEqual(followStates, [false, true]);
  assert.deepEqual(scrolls, []);
});
