import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { findFirstUserMessage, findFirstTitleSource, truncateTitle, sessionDisplayTitle } =
  await jiti.import("./session-title.ts");

test("finds the first user message with usable text", () => {
  const messages = [
    { role: "assistant", content: [{ type: "text", text: "hi" }] },
    { role: "user", content: [{ type: "image", data: "…", mimeType: "image/png" }] },
    { role: "user", content: [{ type: "text", text: "  Fix the SSE reconnect  " }] },
    { role: "user", content: "later" },
  ];
  assert.equal(findFirstUserMessage(messages), "Fix the SSE reconnect");
});

test("accepts plain string content", () => {
  assert.equal(
    findFirstUserMessage([{ role: "user", content: "Ship the release" }]),
    "Ship the release",
  );
});

test("returns undefined when no user turn carries text", () => {
  assert.equal(
    findFirstUserMessage([{ role: "assistant", content: [{ type: "text", text: "hi" }] }]),
    undefined,
  );
});

test("collapses whitespace and caps the title length", () => {
  assert.equal(truncateTitle("  Improve   worktree\ngrouping "), "Improve worktree grouping");
  assert.equal(Array.from(truncateTitle("x".repeat(200))).length, 80);
});

test("prefers a stored name over the first message", () => {
  assert.equal(
    sessionDisplayTitle({ name: "Release notes", firstMessage: "hello", id: "s1" }),
    "Release notes",
  );
});

test("collapses an SDK skill expansion without caller preprocessing", () => {
  const firstMessage =
    '<skill name="review" location="/repo/.omp/skills/review/SKILL.md">\n' +
    "References are relative to /repo/.omp/skills/review.\n\n" +
    "Read the diff carefully.\n</skill>\n\nsrc/main.ts";
  assert.equal(sessionDisplayTitle({ firstMessage, id: "s1" }), "/skill:review src/main.ts");
});

test("trims and truncates the derived title by code points", () => {
  assert.equal(
    sessionDisplayTitle({ firstMessage: `  ${"😀".repeat(60)}  `, id: "s1" }),
    "😀".repeat(50),
  );
});

test("falls back to the id when the first message has no usable text", () => {
  assert.equal(
    sessionDisplayTitle({ firstMessage: "   ", id: "0123456789abcdef" }),
    "0123456789ab",
  );
});

test("falls back to the compaction summary after compaction removed all user messages", () => {
  const messages = [
    {
      role: "compactionSummary",
      summary: "  The session migrated worktrees and rebuilt the sidebar.  ",
    },
  ];
  assert.equal(
    findFirstTitleSource(messages),
    "  The session migrated worktrees and rebuilt the sidebar.  ",
  );
});

test("prefers a real user turn over the compaction summary", () => {
  const messages = [
    { role: "compactionSummary", summary: "stale summary" },
    { role: "user", content: "Fix the SSE reconnect" },
  ];
  assert.equal(findFirstTitleSource(messages), "Fix the SSE reconnect");
});

test("returns undefined when nothing can name the session", () => {
  assert.equal(
    findFirstTitleSource([{ role: "assistant", content: [{ type: "text", text: "hi" }] }]),
    undefined,
  );
  assert.equal(findFirstTitleSource([{ role: "compactionSummary", summary: "" }]), undefined);
});
