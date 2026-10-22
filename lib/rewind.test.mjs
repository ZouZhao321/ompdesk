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

  assert.deepEqual(
    planRewindCommand({ agentRunning: true, bashRunning: false }),
    { handled: true, error: "Cannot rewind while the session is busy" },
  );
});

test("planRewindCommand blocks while bash is running", async () => {
  const { planRewindCommand } = await loadSubject();

  assert.deepEqual(
    planRewindCommand({ agentRunning: false, bashRunning: true }),
    { handled: true, error: "Cannot rewind while the session is busy" },
  );
});

test("planRewindCommand opens the rewind picker when idle", async () => {
  const { planRewindCommand } = await loadSubject();

  assert.deepEqual(
    planRewindCommand({ agentRunning: false, bashRunning: false }),
    { handled: true, action: "openRewind" },
  );
});

test("buildRewindEntries lists every message of a long linear transcript in order", async () => {
  const { buildRewindEntries } = await loadSubject();
  const messages = [
    userMessage("第一个问题"),
    assistantMessage([{ type: "text", text: "第一个回答" }]),
    userMessage("第二个问题"),
    assistantMessage("第二个回答"),
    userMessage("第三个问题"),
    assistantMessage([{ type: "text", text: "第三个回答" }]),
    toolResultMessage([{ type: "text", text: "工具输出" }]),
    assistantMessage("收尾回答"),
  ];
  const entryIds = ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8"];

  const entries = buildRewindEntries(messages, entryIds);

  assert.deepEqual(entries.map((entry) => entry.entryId), entryIds);
  assert.deepEqual(entries.map((entry) => entry.kind), [
    "user",
    "assistant",
    "user",
    "assistant",
    "user",
    "assistant",
    "tool",
    "assistant",
  ]);
  assert.deepEqual(entries.map((entry) => entry.text), [
    "第一个问题",
    "第一个回答",
    "第二个问题",
    "第二个回答",
    "第三个问题",
    "第三个回答",
    "工具输出",
    "收尾回答",
  ]);
});

test("buildRewindEntries skips messages without a paired entry id", async () => {
  const { buildRewindEntries } = await loadSubject();
  const messages = [
    userMessage("保留"),
    assistantMessage("缺少 id"),
    userMessage("空 id"),
    assistantMessage("越界"),
  ];

  const entries = buildRewindEntries(messages, ["e1", "", "e3"]);

  assert.deepEqual(entries.map((entry) => entry.entryId), ["e1", "e3"]);
  assert.deepEqual(entries.map((entry) => entry.text), ["保留", "空 id"]);
});

test("buildRewindEntries maps every message role to a rewind kind", async () => {
  const { buildRewindEntries } = await loadSubject();
  const messages = [
    userMessage("问题"),
    assistantMessage("回答"),
    toolResultMessage([{ type: "text", text: "工具" }]),
    customMessage("自定义"),
    bashExecutionMessage(),
  ];
  const entryIds = ["e1", "e2", "e3", "e4", "e5"];

  const entries = buildRewindEntries(messages, entryIds);

  assert.deepEqual(entries.map((entry) => entry.kind), [
    "user",
    "assistant",
    "tool",
    "other",
    "other",
  ]);
  assert.deepEqual(entries.map((entry) => entry.text), ["问题", "回答", "工具", "自定义", ""]);
});

test("buildRewindEntries extracts text from strings and text blocks only", async () => {
  const { buildRewindEntries } = await loadSubject();
  const messages = [
    userMessage("  保留空白  "),
    assistantMessage([
      { type: "text", text: "第一段" },
      { type: "thinking", thinking: "内部推理" },
      { type: "text", text: "第二段" },
    ]),
    assistantMessage([]),
    customMessage({ type: "text", text: "非数组" }),
  ];
  const entryIds = ["e1", "e2", "e3", "e4"];

  const entries = buildRewindEntries(messages, entryIds);

  assert.deepEqual(entries.map((entry) => entry.text), [
    "  保留空白  ",
    "第一段\n第二段",
    "",
    "",
  ]);
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

test("buildRewindEntries ignores images outside user messages and malformed blocks", async () => {
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

  assert.deepEqual(entries.map((entry) => entry.entryId), ["u1", "a1"]);
  assert.deepEqual(entries[0].images, []);
  assert.equal(entries[0].text, "");
  assert.deepEqual(entries[1].images, []);
  assert.equal(entries[1].text, "只看文字");
});

test("buildRewindEntries returns nothing without paired messages or entry ids", async () => {
  const { buildRewindEntries } = await loadSubject();

  assert.deepEqual(buildRewindEntries([], []), []);
  assert.deepEqual(buildRewindEntries([userMessage("孤立消息")], []), []);
  assert.deepEqual(buildRewindEntries([], ["u1"]), []);
});
