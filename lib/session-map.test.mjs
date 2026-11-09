import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const { turnsFromEntries, buildSessionMap } = await import("./session-map.ts");
const { invalidateSessionListCache, listAllSessions } = await import("./session-reader.ts");
const { seedSessions } = await import("../test-support/session-fixtures.ts");
const { createAgentDirSandbox, switchAgentDir } = await import("../test-support/agent-dir-sandbox.ts");

const user = (id, parentId, text) => ({
  type: "message",
  id,
  parentId,
  timestamp: "t",
  message: { role: "user", content: text },
});
const assistant = (id, parentId, text, toolCalls = []) => ({
  type: "message",
  id,
  parentId,
  timestamp: "t",
  message: {
    role: "assistant",
    content: [
      ...toolCalls.map((call) => ({ type: "toolCall", id: call.id, name: call.name, arguments: {} })),
      ...(text ? [{ type: "text", text }] : []),
    ],
  },
});
const toolResult = (id, parentId, callId) => ({
  type: "message",
  id,
  parentId,
  timestamp: "t",
  message: { role: "toolResult", toolCallId: callId, content: "ok" },
});
const meta = (id, parentId) => ({ type: "model_change", id, parentId, timestamp: "t", model: "p/m" });

test("groups a linear transcript into turns and links them", () => {
  const turns = turnsFromEntries([
    user("u1", null, "第一问"),
    assistant("a1", "u1", "第一答"),
    meta("m1", "a1"),
    user("u2", "m1", "第二问"),
    assistant("a2", "u2", "第二答"),
  ]);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].id, "u1");
  assert.equal(turns[0].parentId, null);
  assert.equal(turns[0].forkEntryId, "a1");
  assert.equal(turns[1].id, "u2");
  assert.equal(turns[1].parentId, "u1");
  assert.equal(turns[1].forkEntryId, "a2");
  assert.equal(turns[1].preview, "第二问");
});

test("two user messages under one answer become sibling branches", () => {
  const turns = turnsFromEntries([
    user("u1", null, "问题"),
    assistant("a1", "u1", "回答"),
    user("u2", "a1", "分支一"),
    assistant("a2", "u2", "答一"),
    user("u3", "a1", "分支二"),
    assistant("a3", "u3", "答二"),
  ]);
  const byId = new Map(turns.map((turn) => [turn.id, turn]));
  assert.equal(byId.get("u2").parentId, "u1");
  assert.equal(byId.get("u3").parentId, "u1");
});

test("an unresolved tool call is never used as a fork point", () => {
  const turns = turnsFromEntries([
    user("u1", null, "跑个命令"),
    assistant("a1", "u1", "", [{ id: "call-1", name: "bash" }]),
  ]);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].forkEntryId, "u1");
  assert.equal(turns[0].answerEntryId, undefined);
  assert.equal(turns[0].toolCount, 1);
});

test("a resolved tool call leaves the result as the safe fork point", () => {
  const turns = turnsFromEntries([
    user("u1", null, "跑个命令"),
    assistant("a1", "u1", "", [{ id: "call-1", name: "bash" }]),
    toolResult("r1", "a1", "call-1"),
  ]);
  assert.equal(turns[0].forkEntryId, "r1");
  assert.equal(turns[0].toolCount, 1);
});

test("an orphan tool result does not become the fork point", () => {
  const turns = turnsFromEntries([
    user("u1", null, "问题"),
    assistant("a1", "u1", "回答"),
    toolResult("r1", "a1", "call-from-elsewhere"),
    user("u2", "r1", "下一问"),
  ]);
  assert.equal(turns[0].forkEntryId, "a1");
  assert.equal(turns[1].parentId, "u1");
});

test("a parent cycle between non-user entries terminates", () => {
  const turns = turnsFromEntries([
    user("u1", null, "问题"),
    assistant("a1", "u1", "回答"),
    { type: "model_change", id: "m1", parentId: "m2", timestamp: "t" },
    { type: "model_change", id: "m2", parentId: "m1", timestamp: "t" },
    user("u2", "m1", "环里的下一问"),
  ]);
  assert.equal(turns.length, 2);
  assert.equal(turns[1].parentId, null);
});

test("the final assistant text wins as the fork point of a tool turn", () => {
  const turns = turnsFromEntries([
    user("u1", null, "跑个命令"),
    assistant("a1", "u1", "", [{ id: "call-1", name: "bash" }]),
    toolResult("r1", "a1", "call-1"),
    assistant("a2", "r1", "结果是 ok"),
  ]);
  assert.equal(turns[0].forkEntryId, "a2");
  assert.equal(turns[0].answerEntryId, "a2");
  assert.equal(turns[0].answerPreview, "结果是 ok");
});

test("a map opened from a fork includes its sibling branches", async (t) => {
  const sandbox = createAgentDirSandbox(t, {
    prefix: "ompdesk-session-map-sandbox-",
    dirs: ["fixtures/agent", "workspaces"],
    beforeRestore() {
      invalidateSessionListCache();
    },
  });
  const agentDir = join(sandbox.root, "fixtures", "agent");
  const cwd = join(sandbox.root, "workspaces", "project");
  mkdirSync(cwd, { recursive: true });

  const sessions = await seedSessions("branch", { agentDir, cwd });
  switchAgentDir(agentDir);
  invalidateSessionListCache();

  const listed = await listAllSessions({ force: true });
  const child = listed.find(
    (session) => sessions.some((seeded) => seeded.id === session.id) && session.parentSessionId,
  );
  assert.ok(child, "the branch fixture must contain a fork");
  const payload = await buildSessionMap(child.id);
  assert.ok(payload);

  const sessionIds = new Set(payload.nodes.map((node) => node.sessionId));
  for (const session of sessions) {
    assert.ok(sessionIds.has(session.id), `missing turns from session ${session.id}`);
  }
});
