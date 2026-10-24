import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const {
  AgentRunTracker,
  currentRequestId,
  resolveSessionModelRole,
  writeAgentRunRecords,
} = await import("./agent-run-log.ts");
const { configureLogging, flushLogs, runWithLogContext } = await import("./logging.ts");

function createLogDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-agent-run-log-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function readRecords(dir) {
  const records = [];
  for (const name of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, name), "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) records.push(JSON.parse(line));
    }
  }
  return records;
}

function makeTracker(clock = { value: 1_000 }) {
  const tracker = new AgentRunTracker({
    now: () => clock.value,
    sessionId: () => "sess-1",
    newRunId: () => "run-fixed",
  });
  return { tracker, clock };
}

function assistantMessage(overrides = {}) {
  const {
    stopReason = "stop",
    input = 0,
    output = 0,
    cacheRead = 0,
    cacheWrite = 0,
    provider = "anthropic",
    model = "claude-sonnet-4",
    content = [{ type: "text", text: "ASSISTANT-OUTPUT-MUST-NOT-LEAK" }],
  } = overrides;
  return {
    role: "assistant",
    content,
    provider,
    model,
    usage: {
      input,
      output,
      cacheRead,
      cacheWrite,
      totalTokens: input + output + cacheRead + cacheWrite,
    },
    stopReason,
  };
}

function startContext(overrides = {}) {
  return {
    sessionId: "sess-1",
    provider: "anthropic",
    model: "claude-sonnet-4",
    role: "default",
    thinkingLevel: "high",
    ...overrides,
  };
}

test("logs a start record with run id, model metadata and the captured request id", () => {
  const { tracker } = makeTracker();
  const records = tracker.begin(startContext({ requestId: "req-ctx" }));

  assert.equal(records.length, 1);
  const [record] = records;
  assert.equal(record.level, "info");
  assert.equal(record.message, "agent.run.start");
  assert.equal(record.fields.sessionId, "sess-1");
  assert.equal(record.fields.runId, "run-fixed");
  assert.equal(record.fields.provider, "anthropic");
  assert.equal(record.fields.model, "claude-sonnet-4");
  assert.equal(record.fields.role, "default");
  assert.equal(record.fields.thinkingLevel, "high");
  assert.equal(record.fields.requestId, "req-ctx");
  assert.equal(tracker.activeRunId, "run-fixed");
});

test("does not invent a request id when the run was not started by a request", () => {
  const { tracker } = makeTracker();
  const [record] = tracker.begin(startContext());
  assert.equal("requestId" in record.fields, false);
});

test("sums turn usage and closes a normal run on the terminal agent_end", () => {
  const { tracker, clock } = makeTracker();
  tracker.begin(startContext());

  assert.deepEqual(tracker.push({ type: "agent_start" }), []);
  assert.deepEqual(
    tracker.push({ type: "turn_end", message: assistantMessage({ stopReason: "toolUse", input: 10, output: 5 }) }),
    [],
  );
  assert.deepEqual(
    tracker.push({ type: "turn_end", message: assistantMessage({ input: 3, output: 2, cacheRead: 4, cacheWrite: 1 }) }),
    [],
  );

  clock.value = 1_750;
  const records = tracker.push({
    type: "agent_end",
    messages: [assistantMessage({ input: 3, output: 2, cacheRead: 4, cacheWrite: 1 })],
  });

  assert.equal(records.length, 1);
  const [record] = records;
  assert.equal(record.message, "agent.run.end");
  assert.equal(record.level, "info");
  assert.equal(record.fields.runId, "run-fixed");
  assert.equal(record.fields.sessionId, "sess-1");
  assert.equal(record.fields.durationMs, 750);
  assert.equal(record.fields.stopReason, "stop");
  assert.equal(record.fields.turns, 2);
  assert.equal(record.fields.inputTokens, 13);
  assert.equal(record.fields.outputTokens, 7);
  assert.equal(record.fields.cacheReadTokens, 4);
  assert.equal(record.fields.cacheWriteTokens, 1);
  assert.equal(record.fields.totalTokens, 25);
  assert.equal(tracker.activeRunId, undefined);
});

test("keeps a run open while agent_end is not terminal", () => {
  const { tracker } = makeTracker();
  tracker.begin(startContext());

  assert.deepEqual(
    tracker.push({ type: "agent_end", messages: [assistantMessage()], yielded: false }),
    [],
  );
  assert.deepEqual(
    tracker.push({ type: "agent_end", messages: [assistantMessage()], isTerminal: false }),
    [],
  );
  assert.equal(tracker.activeRunId, "run-fixed");

  const records = tracker.push({ type: "agent_end", messages: [assistantMessage()] });
  assert.equal(records.length, 1);
  assert.equal(records[0].fields.stopReason, "stop");
});

test("records a failed run with the error and an error level", () => {
  const { tracker, clock } = makeTracker();
  tracker.begin(startContext());
  clock.value = 1_400;
  const error = new Error("provider rejected the request");

  const records = tracker.finish({ stopReason: "error", error });

  assert.equal(records.length, 1);
  const [record] = records;
  assert.equal(record.level, "error");
  assert.equal(record.fields.stopReason, "error");
  assert.equal(record.fields.failed, true);
  assert.equal(record.fields.durationMs, 400);
  assert.equal(record.fields.error, error);
  assert.equal(tracker.activeRunId, undefined);
});

test("records the abort command and ends the run as aborted", () => {
  const { tracker } = makeTracker();
  tracker.begin(startContext());
  tracker.push({ type: "turn_end", message: assistantMessage({ stopReason: "toolUse", input: 7, output: 1 }) });

  const commandRecords = tracker.command("abort", { ok: true, durationMs: 12 });
  assert.equal(commandRecords.length, 1);
  assert.equal(commandRecords[0].message, "agent.run.command");
  assert.equal(commandRecords[0].level, "info");
  assert.equal(commandRecords[0].fields.sessionId, "sess-1");
  assert.equal(commandRecords[0].fields.runId, "run-fixed");
  assert.equal(commandRecords[0].fields.command, "abort");
  assert.equal(commandRecords[0].fields.ok, true);
  assert.equal(commandRecords[0].fields.durationMs, 12);

  const endRecords = tracker.finish({ stopReason: "aborted" });
  assert.equal(endRecords.length, 1);
  assert.equal(endRecords[0].level, "warn");
  assert.equal(endRecords[0].fields.stopReason, "aborted");
  assert.equal(endRecords[0].fields.inputTokens, 7);

  assert.deepEqual(tracker.push({ type: "agent_end", messages: [assistantMessage()] }), []);
});

test("records a fork command and closes an in-flight run as forked", () => {
  const { tracker } = makeTracker();
  tracker.begin(startContext());

  const commandRecords = tracker.command("fork", { ok: true, durationMs: 30, newSessionId: "sess-new" });
  assert.equal(commandRecords[0].fields.command, "fork");
  assert.equal(commandRecords[0].fields.newSessionId, "sess-new");
  assert.equal(commandRecords[0].fields.runId, "run-fixed");

  const endRecords = tracker.finish({ stopReason: "fork" });
  assert.equal(endRecords[0].fields.stopReason, "fork");
  assert.equal(endRecords[0].level, "warn");
});

test("records failed commands without the run id when no run is active", () => {
  const { tracker } = makeTracker();
  const error = new Error("steer rejected");

  const [record] = tracker.command("steer", { ok: false, durationMs: 4, error });

  assert.equal(record.level, "warn");
  assert.equal(record.fields.sessionId, "sess-1");
  assert.equal(record.fields.runId, undefined);
  assert.equal(record.fields.ok, false);
  assert.equal(record.fields.error, error);
});

test("records steer, follow_up and compact command results", () => {
  const { tracker } = makeTracker();
  for (const command of ["steer", "follow_up", "compact"]) {
    const [record] = tracker.command(command, { ok: true, durationMs: 1 });
    assert.equal(record.fields.command, command);
    assert.equal(record.fields.ok, true);
    assert.equal(record.level, "info");
  }
});

test("gives every prompt its own run id", () => {
  const tracker = new AgentRunTracker({ now: () => 1_000, sessionId: () => "sess-1" });
  const ids = new Set();
  for (let index = 0; index < 3; index += 1) {
    const [start] = tracker.begin(startContext());
    ids.add(start.fields.runId);
    tracker.finish();
  }
  assert.equal(ids.size, 3);
  assert.equal(tracker.activeRunId, undefined);
});

test("never puts prompt, completion, tool arguments or message content into a record", () => {
  const { tracker } = makeTracker();
  const records = [];
  records.push(...tracker.begin(startContext()));
  records.push(...tracker.push({
    type: "turn_end",
    message: assistantMessage({
      content: [
        { type: "text", text: "COMPLETION-FRAGMENT" },
        { type: "toolCall", name: "bash", arguments: { command: "TOOL-ARG-FRAGMENT" } },
      ],
    }),
  }));
  records.push(...tracker.push({
    type: "agent_end",
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "PROMPT-FRAGMENT" }],
      },
      assistantMessage(),
      {
        role: "toolResult",
        content: [{ type: "text", text: "TOOL-RESULT-FRAGMENT" }],
      },
    ],
  }));
  records.push(...tracker.command("steer", { ok: true, durationMs: 2 }));

  const serialized = JSON.stringify(records);
  for (const fragment of [
    "PROMPT-FRAGMENT",
    "COMPLETION-FRAGMENT",
    "TOOL-ARG-FRAGMENT",
    "TOOL-RESULT-FRAGMENT",
  ]) {
    assert.equal(serialized.includes(fragment), false, `${fragment} leaked into the run records`);
  }
});

test("captures the request id from the log context only while one is active", () => {
  assert.equal(currentRequestId(), undefined);
  runWithLogContext({ requestId: "req-inner" }, () => {
    assert.equal(currentRequestId(), "req-inner");
  });
  assert.equal(currentRequestId(), undefined);
});

test("resolves the model role from the newest model_change entry", () => {
  assert.equal(resolveSessionModelRole([]), "default");
  assert.equal(
    resolveSessionModelRole([
      { type: "model_change", model: "anthropic/claude", role: "smol" },
      { type: "message" },
    ]),
    "smol",
  );
  assert.equal(
    resolveSessionModelRole([
      { type: "model_change", model: "anthropic/claude", role: "smol" },
      { type: "model_change", model: "openai/gpt" },
    ]),
    "default",
  );
});

test("writes run records through the ompdesk process logger", async (t) => {
  const dir = createLogDir(t);
  await configureLogging({ file: dir, stdout: false, env: { NODE_ENV: "production" } });
  const { tracker } = makeTracker();

  writeAgentRunRecords(tracker.begin(startContext({ requestId: "req-writer" })));
  flushLogs();

  const records = readRecords(dir);
  const record = records.find((entry) => entry.message === "agent.run.start");
  assert.ok(record, `expected an agent.run.start record, got ${JSON.stringify(records)}`);
  assert.equal(record.source, "ompdesk");
  assert.equal(record.subsystem, "agent");
  assert.equal(record.level, "info");
  assert.equal(record.requestId, "req-writer");
  assert.equal(record.sessionId, "sess-1");
  assert.equal(record.runId, "run-fixed");
});
