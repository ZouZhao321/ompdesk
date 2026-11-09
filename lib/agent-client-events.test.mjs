import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { toClientEvent } = await jiti.import("./agent-client-events.ts");

test("keeps the agent_end terminal flags without forwarding the transcript", () => {
  const message = { role: "assistant", content: "long transcript" };
  const projected = toClientEvent({
    type: "agent_end",
    messages: [message, message],
    telemetry: { tokens: 1 },
    isTerminal: true,
    yielded: true,
  });

  assert.deepEqual(projected, { type: "agent_end", isTerminal: true, yielded: true });
});

test("forwards a missing terminal flag as undefined so the client keeps its fallback", () => {
  const projected = toClientEvent({ type: "agent_end", messages: [] });

  assert.deepEqual(projected, { type: "agent_end", isTerminal: undefined, yielded: undefined });
});

test("projects message updates and omits turn frames", () => {
  assert.equal(toClientEvent({ type: "turn_start" }), null);
  assert.equal(toClientEvent({ type: "tool_execution_update" }), null);

  const update = toClientEvent({
    type: "message_update",
    assistantMessageEvent: { delta: "x" },
    message: { role: "assistant" },
  });
  assert.deepEqual(update, { type: "message_update", message: { role: "assistant" } });
});

test("passes other events through untouched", () => {
  const event = { type: "agent_start" };

  assert.equal(toClientEvent(event), event);
});

test("keeps explicit non-terminal flags", () => {
  assert.deepEqual(toClientEvent({ type: "agent_end", isTerminal: false, yielded: false }), {
    type: "agent_end",
    isTerminal: false,
    yielded: false,
  });
});
