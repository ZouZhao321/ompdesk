import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { formatGoalStatus, isGoalContinuationEnabled, toGoalStatus } = await jiti.import("./goal-mode.ts");

function status(overrides = {}) {
  return {
    objective: "把覆盖率提升到 90%",
    status: "active",
    enabled: true,
    tokensUsed: 1200,
    timeUsedSeconds: 90,
    ...overrides,
  };
}

test("status conversion returns null without a persisted goal", () => {
  assert.equal(toGoalStatus(undefined), null);
  assert.equal(toGoalStatus({ enabled: true }), null);
});

test("status conversion carries the optional budget only when present", () => {
  const withBudget = toGoalStatus({
    enabled: true,
    goal: { objective: "目标", status: "active", tokensUsed: 10, tokenBudget: 100, timeUsedSeconds: 5 },
  });
  assert.equal(withBudget.tokenBudget, 100);

  const withoutBudget = toGoalStatus({
    enabled: false,
    goal: { objective: "目标", status: "paused", tokensUsed: 10, timeUsedSeconds: 5 },
  });
  assert.equal("tokenBudget" in withoutBudget, false);
  assert.equal(withoutBudget.enabled, false);
});

test("formatted status covers seconds, minutes, hours and missing budgets", () => {
  const seconds = formatGoalStatus(status({ timeUsedSeconds: 12, tokenBudget: 2000 }));
  assert.match(seconds, /Time spent: 12s/);
  assert.match(seconds, /1,200 \/ 2,000 \(800 left\)/);

  const minutes = formatGoalStatus(status({ timeUsedSeconds: 125, tokenBudget: undefined }));
  assert.match(minutes, /Time spent: 2m 5s/);
  assert.match(minutes, /1,200 \(no budget\)/);

  const hours = formatGoalStatus(status({ timeUsedSeconds: 3725, enabled: false }));
  assert.match(hours, /Time spent: 1h 2m/);
  assert.match(hours, /Status: active \(paused\)/);

  const negative = formatGoalStatus(status({ timeUsedSeconds: -5 }));
  assert.match(negative, /Time spent: 0s/);
});

test("continuation mode detection needs an array setting", () => {
  assert.equal(isGoalContinuationEnabled(undefined), false);
  assert.equal(isGoalContinuationEnabled("run"), false);
  assert.equal(isGoalContinuationEnabled(["plan"]), false);
  assert.equal(isGoalContinuationEnabled(["interactive"]), true);
  assert.equal(isGoalContinuationEnabled(["web"]), true);
});
