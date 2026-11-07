import assert from "node:assert/strict";
import test from "node:test";

let subjectPromise;

function loadSubject() {
  subjectPromise ??= (async () => {
    try {
      const { createJiti } = await import("jiti");
      return await createJiti(import.meta.url, { tsconfigPaths: true }).import("./rewind.ts");
    } catch {
      return import("./rewind.ts");
    }
  })();
  return subjectPromise;
}

function userMessage(content) {
  return { role: "user", content, timestamp: 0 };
}

function assistantMessage(content) {
  return { role: "assistant", content, timestamp: 0 };
}

function toolResultMessage(content) {
  return { role: "toolResult", toolCallId: "call-1", toolName: "read", content, timestamp: 0 };
}

function customMessage(content) {
  return { role: "custom", customType: "note", content, display: true, timestamp: 0 };
}

function bashExecutionMessage() {
  return { role: "bashExecution", command: "ls", output: "a.txt", exitCode: 0, timestamp: 0 };
}

test("planRewindCommand blocks while the agent is running", async () => {
  const { planRewindCommand } = await loadSubject();

  assert.deepEqual(planRewindCommand({ agentRunning: true, bashRunning: false }), {
    handled: true,
    error: "Cannot rewind while the session is busy",
  });
});

test("planRewindCommand blocks while bash is running", async () => {
  const { planRewindCommand } = await loadSubject();

  assert.deepEqual(planRewindCommand({ agentRunning: false, bashRunning: true }), {
    handled: true,
    error: "Cannot rewind while the session is busy",
  });
});

test("planRewindCommand opens the rewind picker when idle", async () => {
  const { planRewindCommand } = await loadSubject();

  assert.deepEqual(planRewindCommand({ agentRunning: false, bashRunning: false }), {
    handled: true,
    action: "openRewind",
  });
});

test("buildRewindEntries only exposes the last user message of a long transcript", async () => {
  const { buildRewindEntries } = await loadSubject();
  const messages = [
    userMessage("第一个问题"),
    assistantMessage("第一个回答"),
    userMessage("第二个问题"),
    assistantMessage("第二个回答"),
    userMessage("第三个问题"),
    assistantMessage("第三个回答"),
    toolResultMessage("工具输出"),
    assistantMessage("收尾回答"),
  ];
  const entryIds = ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8"];

  const entries = buildRewindEntries(messages, entryIds);

  assert.deepEqual(entries, [{ entryId: "e5", text: "第三个问题", images: [] }]);
});

test("buildRewindEntries returns the last user message when it is the newest entry", async () => {
  const { buildRewindEntries } = await loadSubject();
  const messages = [
    userMessage("第一个问题"),
    assistantMessage("回答"),
    userMessage("刚发出的问题"),
  ];

  const entries = buildRewindEntries(messages, ["e1", "e2", "e3"]);

  assert.deepEqual(entries, [{ entryId: "e3", text: "刚发出的问题", images: [] }]);
});

test("buildRewindEntries returns nothing without a user message", async () => {
  const { buildRewindEntries } = await loadSubject();
  const messages = [
    assistantMessage("开场白"),
    toolResultMessage("工具输出"),
    customMessage("自定义"),
    bashExecutionMessage(),
  ];

  assert.deepEqual(buildRewindEntries(messages, ["e1", "e2", "e3", "e4"]), []);
  assert.deepEqual(buildRewindEntries([], []), []);
});

test("buildRewindEntries never falls back to an earlier user message without an entry id", async () => {
  const { buildRewindEntries } = await loadSubject();
  const messages = [userMessage("更早的问题"), assistantMessage("回答"), userMessage("最后的问题")];

  assert.deepEqual(buildRewindEntries(messages, ["e1", "e2", ""]), []);
  assert.deepEqual(buildRewindEntries([assistantMessage("前文"), userMessage("越界")], ["e1"]), []);
});

test("buildRewindEntries extracts text from strings and text blocks only", async () => {
  const { buildRewindEntries } = await loadSubject();
  const messages = [
    assistantMessage([{ type: "text", text: "旧回答" }]),
    userMessage([
      { type: "text", text: "第一段" },
      { type: "thinking", thinking: "内部推理" },
      { type: "text", text: "第二段" },
    ]),
    assistantMessage([]),
  ];

  const [entry] = buildRewindEntries(messages, ["a1", "u1", "a2"]);

  assert.equal(entry.entryId, "u1");
  assert.equal(entry.text, "第一段\n第二段");
});

test("buildRewindEntries keeps whitespace of a string user message", async () => {
  const { buildRewindEntries } = await loadSubject();

  const [entry] = buildRewindEntries(
    [userMessage("  保留空白  "), assistantMessage("回答")],
    ["u1", "a1"],
  );

  assert.equal(entry.text, "  保留空白  ");
});

test("buildRewindEntries restores nested and legacy user images", async () => {
  const { buildRewindEntries } = await loadSubject();
  const messages = [
    userMessage([
      { type: "image", source: { type: "base64", data: "aGVsbG8=", media_type: "image/png" } },
      { type: "image", data: "d29ybGQ=", mimeType: "image/jpeg" },
      { type: "text", text: "看图" },
    ]),
  ];

  const [entry] = buildRewindEntries(messages, ["u1"]);

  assert.equal(entry.entryId, "u1");
  assert.equal(entry.text, "看图");
  assert.deepEqual(entry.images, [
    { data: "aGVsbG8=", mimeType: "image/png" },
    { data: "d29ybGQ=", mimeType: "image/jpeg" },
  ]);
});

test("normalizeRewindCommand maps the /branch alias onto the rewind branch", async () => {
  const { normalizeRewindCommand } = await loadSubject();

  assert.equal(normalizeRewindCommand("branch"), "rewind");
  assert.equal(normalizeRewindCommand("rewind"), "rewind");
});

test("normalizeRewindCommand passes other command names through untouched", async () => {
  const { normalizeRewindCommand } = await loadSubject();

  assert.equal(normalizeRewindCommand("fork"), "fork");
  assert.equal(normalizeRewindCommand("goal"), "goal");
  assert.equal(normalizeRewindCommand(""), "");
});

test("isRewindInput accepts a whole /rewind or /branch input with trailing whitespace", async () => {
  const { isRewindInput } = await loadSubject();

  assert.equal(isRewindInput("/rewind"), true);
  assert.equal(isRewindInput("/branch"), true);
  assert.equal(isRewindInput("/branch   "), true);
});

test("isRewindInput rejects arguments, longer names, and bare words", async () => {
  const { isRewindInput } = await loadSubject();

  assert.equal(isRewindInput("/rewind now"), false);
  assert.equal(isRewindInput("/branchy"), false);
  assert.equal(isRewindInput("rewind"), false);
  assert.equal(isRewindInput(""), false);
});

test("isRewindInput is case-sensitive, so /REWIND keeps going to server dispatch", async () => {
  const { isRewindInput } = await loadSubject();

  assert.equal(isRewindInput("/REWIND"), false);
});

test("buildRewindEntries ignores malformed and non-user images", async () => {
  const { buildRewindEntries } = await loadSubject();
  const messages = [
    userMessage([
      { type: "image", source: { type: "url", url: "https://example.test/x.png" } },
      { type: "image", data: "not base64", mimeType: "image/png" },
      { type: "image", source: { type: "base64", data: "aGVsbG8=", media_type: "text/plain" } },
    ]),
    assistantMessage([
      { type: "image", source: { type: "base64", data: "aGVsbG8=", media_type: "image/png" } },
      { type: "text", text: "只看文字" },
    ]),
  ];

  const entries = buildRewindEntries(messages, ["u1", "a1"]);

  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].images, []);
  assert.equal(entries[0].text, "");
});
