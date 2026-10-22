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

const timestamp = "2026-01-01T00:00:00.000Z";

function msg(id, role, content, parentId = null) {
  return { type: "message", id, parentId, timestamp, message: { role, content } };
}

function other(id, type, parentId = null) {
  return { type, id, parentId, timestamp };
}

function node(entry, children = []) {
  return { entry, children };
}

function sampleTree() {
  return [
    node(msg("u1", "user", "原始问题"), [
      node(msg("a1", "assistant", "第一个回答"), [
        node(msg("u2", "user", "另一分支"), [
          node(msg("a2", "assistant", "分支回答")),
        ]),
        node(other("s1", "session_info"), [
          node(msg("t1", "toolResult", [{ type: "text", text: "工具输出" }]), [
            node(msg("a3", "assistant", [{ type: "text", text: "最终回答" }])),
          ]),
        ]),
      ]),
    ]),
  ];
}

test("isRewindCommand accepts branch and rewind without case or padding", async () => {
  const { isRewindCommand } = await loadSubject();

  assert.equal(isRewindCommand("branch"), true);
  assert.equal(isRewindCommand("rewind"), true);
  assert.equal(isRewindCommand("BRANCH"), true);
  assert.equal(isRewindCommand("  Rewind  "), true);
});

test("isRewindCommand rejects unrelated local commands", async () => {
  const { isRewindCommand } = await loadSubject();

  assert.equal(isRewindCommand("fork"), false);
  assert.equal(isRewindCommand("goal"), false);
  assert.equal(isRewindCommand(""), false);
  assert.equal(isRewindCommand("branches"), false);
});

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

test("buildRewindEntries returns only the active leaf path in root-to-leaf order", async () => {
  const { buildRewindEntries } = await loadSubject();

  const entries = buildRewindEntries(sampleTree(), "a3");

  assert.deepEqual(entries.map((entry) => entry.entryId), ["u1", "a1", "t1", "a3"]);
  assert.deepEqual(entries.map((entry) => entry.kind), ["user", "assistant", "tool", "assistant"]);
  assert.deepEqual(entries.map((entry) => entry.text), [
    "原始问题",
    "第一个回答",
    "工具输出",
    "最终回答",
  ]);
});

test("buildRewindEntries follows a different branch when its leaf is active", async () => {
  const { buildRewindEntries } = await loadSubject();

  const entries = buildRewindEntries(sampleTree(), "a2");

  assert.deepEqual(entries.map((entry) => entry.entryId), ["u1", "a1", "u2", "a2"]);
});

test("buildRewindEntries skips non-message entries on the active path", async () => {
  const { buildRewindEntries } = await loadSubject();

  const entries = buildRewindEntries(sampleTree(), "s1");

  assert.deepEqual(entries.map((entry) => entry.entryId), ["u1", "a1"]);
});

test("buildRewindEntries returns nothing for a missing or unknown leaf", async () => {
  const { buildRewindEntries } = await loadSubject();

  assert.deepEqual(buildRewindEntries(sampleTree(), null), []);
  assert.deepEqual(buildRewindEntries(sampleTree(), "missing"), []);
  assert.deepEqual(buildRewindEntries([], "u1"), []);
});

test("buildRewindEntries extracts text from strings and text blocks", async () => {
  const { buildRewindEntries } = await loadSubject();
  const tree = [
    node(msg("u1", "user", "  保留空白  "), [
      node(msg("a1", "assistant", [
        { type: "text", text: "第一段" },
        { type: "thinking", thinking: "内部推理" },
        { type: "text", text: "第二段" },
      ]), [
        node(msg("t1", "toolResult", [])),
      ]),
    ]),
  ];

  const entries = buildRewindEntries(tree, "t1");

  assert.deepEqual(entries.map((entry) => entry.text), ["  保留空白  ", "第一段\n第二段", ""]);
});

test("buildRewindEntries maps message roles to rewind kinds", async () => {
  const { buildRewindEntries } = await loadSubject();
  const tree = [
    node(msg("u1", "user", "问题"), [
      node(msg("a1", "assistant", "回答"), [
        node(msg("t1", "toolResult", "工具"), [
          node(msg("o1", "system", "系统")),
        ]),
      ]),
    ]),
  ];

  const entries = buildRewindEntries(tree, "o1");

  assert.deepEqual(entries.map((entry) => entry.kind), ["user", "assistant", "tool", "other"]);
});

test("buildRewindEntries restores nested and legacy user images", async () => {
  const { buildRewindEntries } = await loadSubject();
  const tree = [
    node(msg("u1", "user", [
      { type: "image", source: { type: "base64", data: "aGVsbG8=", media_type: "image/png" } },
      { type: "image", data: "d29ybGQ=", mimeType: "image/jpeg" },
      { type: "text", text: "看图" },
    ])),
  ];

  const [entry] = buildRewindEntries(tree, "u1");

  assert.equal(entry.text, "看图");
  assert.deepEqual(entry.images, [
    { data: "aGVsbG8=", mimeType: "image/png" },
    { data: "d29ybGQ=", mimeType: "image/jpeg" },
  ]);
});

test("buildRewindEntries ignores images outside user messages and malformed blocks", async () => {
  const { buildRewindEntries } = await loadSubject();
  const tree = [
    node(msg("u1", "user", [
      { type: "image", source: { type: "url", url: "https://example.test/x.png" } },
      { type: "image", data: "not base64", mimeType: "image/png" },
      { type: "image", source: { type: "base64", data: "aGVsbG8=", media_type: "text/plain" } },
    ]), [
      node(msg("a1", "assistant", [
        { type: "image", source: { type: "base64", data: "aGVsbG8=", media_type: "image/png" } },
        { type: "text", text: "只看文字" },
      ])),
    ]),
  ];

  const entries = buildRewindEntries(tree, "a1");

  assert.deepEqual(entries.map((entry) => entry.entryId), ["u1", "a1"]);
  assert.deepEqual(entries[0].images, []);
  assert.equal(entries[0].text, "");
  assert.deepEqual(entries[1].images, []);
  assert.equal(entries[1].text, "只看文字");
});
