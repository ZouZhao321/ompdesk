import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import test, { after, before } from "node:test";

const { buildSessionMap, readMapTurn } = await import("./session-map.ts");
const { invalidateSessionListCache, listAllSessions } = await import("./session-reader.ts");
const { seedSessions } = await import("../test-support/session-fixtures.ts");
const { restoreAgentDir, switchAgentDir } = await import("../test-support/agent-dir-sandbox.ts");

const sandboxRoot = join(process.cwd(), ".tmp", "lib-logic-one", "session-map");
const runtimeAgentDir = join(sandboxRoot, "runtime", "agent");
const fixtureAgentDir = join(sandboxRoot, "fixtures", "agent");
const workspaceDir = join(sandboxRoot, "workspace");

let seededSessions;
let forkedSession;
let mapPayload;
let initialAgentDir;

before(async () => {
  rmSync(sandboxRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  for (const dir of [runtimeAgentDir, fixtureAgentDir, workspaceDir]) mkdirSync(dir, { recursive: true });
  initialAgentDir = switchAgentDir(runtimeAgentDir);
  try {
    seededSessions = await seedSessions("branch", { agentDir: fixtureAgentDir, cwd: workspaceDir });
    switchAgentDir(fixtureAgentDir);
    invalidateSessionListCache();
    const listed = await listAllSessions({ force: true });
    const seededIds = new Set(seededSessions.map((session) => session.id));
    forkedSession = listed.find((session) => seededIds.has(session.id) && session.parentSessionId);
    assert.ok(forkedSession, "the branch fixture must contain a fork");
    mapPayload = await buildSessionMap(forkedSession.id);
    assert.ok(mapPayload);
  } catch (error) {
    restoreAgentDir(initialAgentDir);
    rmSync(sandboxRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    throw error;
  }
});

after(() => {
  restoreAgentDir(initialAgentDir);
  rmSync(sandboxRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("reads a turn's user and answer text from its fork family", async () => {
  const node = mapPayload.nodes.find((candidate) => candidate.sessionId === forkedSession.id) ?? mapPayload.nodes[0];
  assert.ok(node);

  const detail = await readMapTurn(forkedSession.id, node.id);

  assert.ok(detail);
  assert.equal(typeof detail.userText, "string");
  assert.ok(detail.userText.length > 0);
  assert.ok(Array.isArray(detail.tools));
  assert.equal(typeof detail.answerText, "string");
  assert.equal(detail.truncated, false);
});

test("returns null for a turn the map does not contain", async () => {
  assert.equal(await readMapTurn(forkedSession.id, "turn-that-does-not-exist"), null);
});

test("returns null for an unknown session", async () => {
  const node = mapPayload.nodes[0];
  assert.equal(await readMapTurn("session-that-does-not-exist", node.id), null);
});
