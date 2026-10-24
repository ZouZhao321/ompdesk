import assert from "node:assert/strict";
import test from "node:test";

const { CARD_HEIGHT, ROW_GAP, layoutTurnTree } = await import("./map-layout.ts");

test("a linear conversation stays in one lane", () => {
  const result = layoutTurnTree([
    { id: "u1", parentId: null },
    { id: "u2", parentId: "u1" },
    { id: "u3", parentId: "u2" },
  ]);
  assert.equal(result.cards.length, 3);
  assert.deepEqual(result.cards.map((card) => card.x), [0, 0, 0]);
  assert.deepEqual(result.cards.map((card) => card.y), [0, CARD_HEIGHT + ROW_GAP, (CARD_HEIGHT + ROW_GAP) * 2]);
  assert.deepEqual(result.edges, [
    { from: "u1", to: "u2" },
    { from: "u2", to: "u3" },
  ]);
});

test("a second child opens a new lane beside the trunk", () => {
  const result = layoutTurnTree([
    { id: "u1", parentId: null },
    { id: "u2", parentId: "u1" },
    { id: "u3", parentId: "u1" },
  ]);
  const byId = new Map(result.cards.map((card) => [card.id, card]));
  assert.equal(byId.get("u2").x, 0);
  assert.ok(byId.get("u3").x > byId.get("u2").x);
  assert.equal(byId.get("u3").y, CARD_HEIGHT + ROW_GAP);
});

test("missing parents become roots instead of dropping nodes", () => {
  const result = layoutTurnTree([
    { id: "u1", parentId: "gone" },
    { id: "u2", parentId: "u1" },
  ]);
  assert.equal(result.cards.length, 2);
  assert.equal(result.edges.length, 1);
});

test("the longest branch keeps the trunk lane", () => {
  const result = layoutTurnTree([
    { id: "u1", parentId: null },
    { id: "dead", parentId: "u1" },
    { id: "main", parentId: "u1" },
    { id: "m2", parentId: "main" },
    { id: "m3", parentId: "m2" },
  ]);
  const byId = new Map(result.cards.map((card) => [card.id, card]));
  assert.equal(byId.get("main").x, 0);
  assert.ok(byId.get("dead").x > 0);
});

test("a cycle still places every node exactly once", () => {
  const result = layoutTurnTree([
    { id: "a", parentId: "b" },
    { id: "b", parentId: "a" },
  ]);
  assert.equal(result.cards.length, 2);
});
