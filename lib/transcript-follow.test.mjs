import test from "node:test";
import assert from "node:assert/strict";

async function loadSubject() {
  return import("./transcript-follow.ts");
}

test("brings the view back to the end whenever a prompt is submitted", async () => {
  const { reduceFollow } = await loadSubject();

  // 提交不看之前的开关：上滚过、暂停跟随的视图也要恢复跟随并回到底部。
  assert.deepEqual(reduceFollow({ type: "submit" }), { paused: false, scrollToEnd: "auto" });
});

test("pauses following on a rail jump and leaves the scrolling to the jump", async () => {
  const { reduceFollow } = await loadSubject();

  assert.deepEqual(reduceFollow({ type: "pause" }), { paused: true, scrollToEnd: null });
});

test("resumes following with a smooth scroll", async () => {
  const { reduceFollow } = await loadSubject();

  assert.deepEqual(reduceFollow({ type: "resume" }), { paused: false, scrollToEnd: "smooth" });
});

test("stops following when the user scrolls away from the bottom", async () => {
  const { reduceFollow, FOLLOW_BOTTOM_THRESHOLD_PX } = await loadSubject();

  assert.deepEqual(
    reduceFollow({ type: "scroll", userDriven: true, programmaticWindow: false, distanceFromBottom: FOLLOW_BOTTOM_THRESHOLD_PX + 1 }),
    { paused: true, scrollToEnd: null },
  );
});

test("keeps following while the user stays at the bottom", async () => {
  const { reduceFollow, FOLLOW_BOTTOM_THRESHOLD_PX } = await loadSubject();

  assert.deepEqual(
    reduceFollow({ type: "scroll", userDriven: true, programmaticWindow: false, distanceFromBottom: FOLLOW_BOTTOM_THRESHOLD_PX }),
    { paused: false, scrollToEnd: null },
  );
  // 列表自己跟随到底部时也恢复跟随，不算用户操作。
  assert.deepEqual(
    reduceFollow({ type: "scroll", userDriven: false, programmaticWindow: false, distanceFromBottom: 0 }),
    { paused: false, scrollToEnd: null },
  );
});

test("ignores programmatic scrolling inside the quiet window", async () => {
  const { reduceFollow } = await loadSubject();

  // 平滑滚动过程中离底部还远，既不暂停也不恢复。
  assert.equal(reduceFollow({ type: "scroll", userDriven: false, programmaticWindow: true, distanceFromBottom: 900 }), null);
  // 静默窗口内的滚动到底部同样不下结论，交给窗口之外的观测。
  assert.equal(reduceFollow({ type: "scroll", userDriven: false, programmaticWindow: true, distanceFromBottom: 0 }), null);
});

test("leaves the state alone when nobody touched the list", async () => {
  const { reduceFollow } = await loadSubject();

  // 内容增高、行被重新测量引起的滚动不是用户操作，离底部远也不暂停。
  assert.equal(reduceFollow({ type: "scroll", userDriven: false, programmaticWindow: false, distanceFromBottom: 640 }), null);
});
