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
    reduceFollow({ type: "scroll", userDriven: true, distanceFromBottom: FOLLOW_BOTTOM_THRESHOLD_PX + 1 }),
    { paused: true, scrollToEnd: null },
  );
});

test("keeps following while the user stays at the bottom", async () => {
  const { reduceFollow, FOLLOW_BOTTOM_THRESHOLD_PX } = await loadSubject();

  assert.deepEqual(
    reduceFollow({ type: "scroll", userDriven: true, distanceFromBottom: FOLLOW_BOTTOM_THRESHOLD_PX }),
    { paused: false, scrollToEnd: null },
  );
});

test("leaves the switch alone for scrolling nobody drove", async () => {
  const { reduceFollow } = await loadSubject();

  // 内容增高、行被重新测量引起的滚动不是用户操作，离底部远也不暂停。
  assert.equal(reduceFollow({ type: "scroll", userDriven: false, distanceFromBottom: 640 }), null);
  // 列表跟着末尾输出自己滚到底部同样不下结论。
  assert.equal(reduceFollow({ type: "scroll", userDriven: false, distanceFromBottom: 0 }), null);
});

test("does not resume following for the jump's own scroll near the bottom", async () => {
  const { reduceFollow, FOLLOW_BOTTOM_THRESHOLD_PX } = await loadSubject();

  // 跳到最后一轮时落点就在贴底距离内，但这次滚动是列表按跳转要求做的：这里若恢复
  // 跟随，跳转刚关掉的跟随就被抹掉，「回到底部」按钮不再出现，后续输出又把视图拽回末尾。
  assert.equal(
    reduceFollow({ type: "scroll", userDriven: false, distanceFromBottom: FOLLOW_BOTTOM_THRESHOLD_PX }),
    null,
  );
  assert.equal(reduceFollow({ type: "scroll", userDriven: false, distanceFromBottom: 0 }), null);
});
