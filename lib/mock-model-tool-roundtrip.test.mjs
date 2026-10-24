import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

import {
  collectUntilPromptDone,
  createMockModelForScript,
  disposeMockSession,
  makeSandbox,
  startMockSession,
  textOf,
} from "./testing/mock-session-harness.mjs";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

const FIXTURE_NAME = "tool-roundtrip.txt";
const FIXTURE_TEXT = "离线夹具：工具调用往返";
const FINAL_TEXT = "读完了，夹具内容如上";

function toolResultsIn(messages) {
  return (messages ?? []).filter((message) => message?.role === "toolResult");
}

test("a tool call round-trips its result into the next model call and the final text reaches the subscriber", async (t) => {
  const sandbox = makeSandbox();
  writeFileSync(join(sandbox.cwd, FIXTURE_NAME), `${FIXTURE_TEXT}\n`, "utf8");

  const mock = createMockModelForScript([
    { content: [{ type: "toolCall", name: "read", arguments: { path: FIXTURE_NAME } }] },
    { content: [FINAL_TEXT] },
  ]);

  const { started } = await startMockSession({ sandbox, model: mock });
  const wrapper = new AgentSessionWrapper(started.session, started.eventBus);
  wrapper.start();

  t.after(() => disposeMockSession({ wrapper, started, sandbox }));

  const collected = collectUntilPromptDone(wrapper);
  try {
    await wrapper.send({ type: "prompt", message: "读一下夹具文件" });
    await collected.done;
  } finally {
    collected.unsubscribe();
  }

  assert.equal(mock.calls.length, 2, "one prompt with a tool call must cost exactly two model calls");

  const toolStart = collected.events.find(
    (event) => event.type === "tool_execution_start" && event.toolName === "read",
  );
  assert.ok(toolStart, "no tool_execution_start event for the scripted read call reached the subscriber");

  const toolEnd = collected.events.find((event) => event.type === "tool_execution_end" && event.toolName === "read");
  assert.ok(toolEnd, "no tool_execution_end event for the scripted read call reached the subscriber");
  assert.equal(toolEnd.isError, false, "the read tool reported an error");
  assert.equal(toolEnd.toolCallId, toolStart.toolCallId, "tool start and end events must describe the same call");

  const firstTurnResults = toolResultsIn(mock.calls[0].context.messages);
  assert.equal(firstTurnResults.length, 0, "the first model call must not already contain a tool result");

  const secondTurnResults = toolResultsIn(mock.calls[1].context.messages);
  assert.equal(secondTurnResults.length, 1, "the second model call must receive exactly one tool result message");
  const toolResult = secondTurnResults[0];
  assert.equal(toolResult.toolName, "read");
  assert.equal(toolResult.toolCallId, toolEnd.toolCallId, "the backfilled result must answer the executed tool call");
  assert.equal(toolResult.isError, false, "the backfilled tool result must not be an error result");
  assert.ok(
    textOf(toolResult).includes(FIXTURE_TEXT),
    `the backfilled tool result must carry the file contents; got: ${JSON.stringify(textOf(toolResult))}`,
  );

  const assistantEnd = collected.events.filter(
    (event) => event.type === "message_end" && event.message?.role === "assistant",
  ).at(-1);
  assert.ok(assistantEnd, "no assistant message_end event reached the subscriber");
  assert.equal(textOf(assistantEnd.message), FINAL_TEXT);

  assert.equal(wrapper.isRunning(), false, "wrapper still reports a running prompt after the terminal event");
});
