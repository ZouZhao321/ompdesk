import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

import {
  collectUntilPromptDone,
  createMockModelForReply,
  disposeMockSession,
  makeSandbox,
  startMockSession,
  textOf,
} from "./testing/mock-session-harness.mjs";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

const REPLY = "收到，这是假模型的回复";

test("a prompt reaches the assistant message and prompt_done through the real session pipeline", { timeout: 30_000 }, async (t) => {
  const sandbox = makeSandbox(t);
  const mock = createMockModelForReply(REPLY);
  const { started } = await startMockSession({ sandbox, model: mock });

  const wrapper = new AgentSessionWrapper(started.session, started.eventBus);
  wrapper.start();

  t.after(() => disposeMockSession({ wrapper, started, sandbox }));

  const collected = collectUntilPromptDone(wrapper);
  try {
    await wrapper.send({ type: "prompt", message: "你好" });
    await collected.done;
  } finally {
    collected.unsubscribe();
  }

  const assistantEnd = collected.events.find(
    (event) => event.type === "message_end" && event.message?.role === "assistant",
  );
  assert.ok(assistantEnd, "no assistant message_end event reached the subscriber");
  assert.equal(textOf(assistantEnd.message), REPLY);
  assert.ok(
    collected.events.some((event) => event.type === "agent_start"),
    "agent_start never reached the subscriber",
  );
  assert.equal(wrapper.isRunning(), false, "wrapper still reports a running prompt after prompt_done");
  assert.equal(mock.calls.length, 1, "the mock provider should serve exactly one call");
});
