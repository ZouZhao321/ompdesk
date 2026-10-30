import test from "node:test";
import assert from "node:assert/strict";

async function loadSubject() {
  return import("./transcript-rail-jump.ts");
}

test("realigns once when the list reports it stopped scrolling", async () => {
  const { settleRailJump } = await loadSubject();

  const settled = settleRailJump({ pending: 4 });

  assert.equal(settled.realign, 4);
  assert.equal(settled.state.pending, null);
});

test("still clears a jump that produced no scrolling", async () => {
  const { settleRailJump } = await loadSubject();

  // 点击已经在顶部的圆点不产生滚动，等不到列表的停止回调；兜底清算给出唯一一次
  // 重新对齐，之后任意一次滚动停下都不会再把视图拽回这一轮。
  const fallback = settleRailJump({ pending: 2 });
  assert.equal(fallback.realign, 2);

  const laterScrollStop = settleRailJump(fallback.state);
  assert.equal(laterScrollStop.realign, null);
  assert.equal(laterScrollStop.state.pending, null);
});

test("settles idly when nothing is pending", async () => {
  const { RAIL_JUMP_IDLE, settleRailJump } = await loadSubject();

  assert.equal(settleRailJump(RAIL_JUMP_IDLE).realign, null);
});
