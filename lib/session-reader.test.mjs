import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { sessionPathKey } = await jiti.import("./session-path.ts");
const {
  listAllSessions,
  mergeSessionLists,
  buildSessionContext,
  cacheSessionPath,
  invalidateSessionListCache,
  invalidateSessionPathCache,
  readSessionHeader,
  resolveSessionIdByPath,
  resolveSessionPath,
} = await jiti.import("./session-reader.ts");
const { SessionManager } = await jiti.import("@oh-my-pi/pi-coding-agent");
const { seedSessions } = await jiti.import("../test-support/session-fixtures.ts");
const { createAgentDirSandbox, switchAgentDir } = await jiti.import("../test-support/agent-dir-sandbox.ts");
const { sessionDisplayTitle } = await jiti.import("./session-title.ts");

function resetSessionListState() {
  globalThis.__ompSessionListCache = undefined;
  globalThis.__ompSessionListPromise = undefined;
  globalThis.__ompSessionListPromiseGeneration = undefined;
  globalThis.__ompSessionListGeneration = 0;
}

/**
 * 每个用例一份临时目录：`runtime/agent` 是活动的 agent 目录，`fixtures/agent` 只放
 * 样本，`workspaces` 是样本记录的 cwd。
 *
 * 铺样本会 setSessionName，标题写进活动目录的 history.db，所以活动目录不能是样本
 * 目录；读取前用 `readFixtures()` 切过去。
 */
function createSessionSandbox(t) {
  const sandbox = createAgentDirSandbox(t, {
    prefix: "ompdesk-session-reader-sandbox-",
    dirs: ["fixtures/agent", "workspaces"],
    // 列表缓存跟着活动目录走，恢复原目录前先清掉指向沙箱的缓存。
    beforeRestore() {
      invalidateSessionListCache();
      resetSessionListState();
    },
  });
  resetSessionListState();
  invalidateSessionListCache();

  const fixturesAgentDir = join(sandbox.root, "fixtures", "agent");
  return {
    fixturesAgentDir,
    workspaces: join(sandbox.root, "workspaces"),
    /** 把活动 agent 目录切到样本目录，之后的 listAllSessions 才扫描样本。 */
    readFixtures() {
      switchAgentDir(fixturesAgentDir);
      invalidateSessionListCache();
    },
  };
}

function workspaceDir(sandbox, name) {
  const dir = join(sandbox.workspaces, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 列表里的 modified 就是文件 mtime，显式错开才能断言 mtime 透传与合并后的倒序。 */
function setSessionModified(session, timestamp) {
  const time = new Date(timestamp);
  utimesSync(session.path, time, time);
}

/**
 * 样本的收尾消息都是正常停下的助手回复，尾部状态另需一条消息来定位。追加的消息
 * 接在会话最后一条消息之后 1 秒，文件内的时间戳保持递增。
 */
async function appendSessionMessage(sessionPath, buildMessage) {
  const manager = await SessionManager.open(sessionPath, undefined, undefined, { suppressBreadcrumb: true });
  try {
    const lastMessage = manager
      .getEntries()
      .filter((entry) => entry.type === "message")
      .at(-1)?.message;
    assert.ok(lastMessage, `会话 ${sessionPath} 应至少有一条消息`);
    manager.appendMessage(buildMessage(lastMessage.timestamp + 1000));
    await manager.flush();
  } finally {
    await manager.close();
  }
}

function assistantTail({ content, stopReason = "stop", timestamp }) {
  return {
    role: "assistant",
    content,
    api: "fixture",
    provider: "fixture",
    model: "fixture",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp,
  };
}

function userEntry(id, parentId, content, timestamp = "2026-01-01T00:00:00.000Z") {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "user",
      content,
    },
  };
}

function assistantEntry(id, parentId, text, timestamp = "2026-01-01T00:00:00.000Z") {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "assistant",
      provider: "test",
      model: "test-model",
      content: [{ type: "text", text }],
    },
  };
}

// 网页端默认不折叠：摘要留在压缩发生的位置，压缩前的每一轮都进转写区，
// 提问跳转条的圆点与会话地图的落点才有目标。显式开启折叠时退回 omp TUI 的
// 保留段语义。
test("renders every turn with the summary at the compaction point by default", () => {
  const entries = [
    userEntry("u1", null, "old user request"),
    assistantEntry("a1", "u1", "old assistant answer"),
    userEntry("u2", "a1", "kept user request"),
    {
      type: "compaction",
      id: "cmp",
      parentId: "u2",
      timestamp: "2026-01-01T00:00:03.000Z",
      summary: "old exchange summary",
      firstKeptEntryId: "u2",
      tokensBefore: 123,
    },
    userEntry("u3", "cmp", "after compaction"),
  ];

  const context = buildSessionContext(entries);

  assert.deepEqual(context.entryIds, ["u1", "a1", "u2", "cmp", "u3"]);
  assert.deepEqual(
    context.messages.map((message) => [message.role, message.customType, message.content]),
    [
      ["user", undefined, "old user request"],
      ["assistant", undefined, [{ type: "text", text: "old assistant answer" }]],
      ["user", undefined, "kept user request"],
      ["custom", "compaction", "old exchange summary"],
      ["user", undefined, "after compaction"],
    ],
  );
});

test("collapses compacted history when asked to, keeping the summary in place", () => {
  const entries = [
    userEntry("u1", null, "old user request"),
    assistantEntry("a1", "u1", "old assistant answer"),
    userEntry("u2", "a1", "kept user request"),
    {
      type: "compaction",
      id: "cmp",
      parentId: "u2",
      timestamp: "2026-01-01T00:00:03.000Z",
      summary: "old exchange summary",
      firstKeptEntryId: "u2",
      tokensBefore: 123,
    },
    userEntry("u3", "cmp", "after compaction"),
  ];

  const context = buildSessionContext(entries, undefined, { collapseCompactedHistory: true });

  assert.deepEqual(context.entryIds, ["u2", "cmp", "u3"]);
  assert.equal(context.messages.length, context.entryIds.length);
});

test("uses only the latest compaction on the active path", () => {
  const entries = [
    userEntry("u1", null, "old request"),
    assistantEntry("a1", "u1", "old answer"),
    userEntry("u2", "a1", "first kept request"),
    {
      type: "compaction",
      id: "cmp1",
      parentId: "u2",
      timestamp: "2026-01-01T00:00:03.000Z",
      summary: "first summary",
      firstKeptEntryId: "u2",
      tokensBefore: 100,
    },
    assistantEntry("a2", "cmp1", "second kept answer"),
    userEntry("u3", "a2", "second kept request"),
    {
      type: "compaction",
      id: "cmp2",
      parentId: "u3",
      timestamp: "2026-01-01T00:00:06.000Z",
      summary: "latest summary",
      firstKeptEntryId: "a2",
      tokensBefore: 200,
    },
    assistantEntry("a3", "cmp2", "latest answer"),
  ];

  const collapsed = buildSessionContext(entries, undefined, { collapseCompactedHistory: true });

  assert.deepEqual(collapsed.entryIds, ["a2", "u3", "cmp2", "a3"]);
  assert.equal(collapsed.messages[2].role, "custom");
  assert.equal(collapsed.messages[2].content, "latest summary");
  assert.equal(collapsed.messages.length, collapsed.entryIds.length);

  const expanded = buildSessionContext(entries);
  assert.deepEqual(expanded.entryIds, ["u1", "a1", "u2", "cmp1", "a2", "u3", "cmp2", "a3"]);
  assert.deepEqual(
    expanded.messages.filter((message) => message.role === "custom").map((message) => message.content),
    ["first summary", "latest summary"],
  );
});

test("uses the selected leaf's path before a later compaction", () => {
  const entries = [
    userEntry("u1", null, "root request"),
    assistantEntry("a1", "u1", "root answer"),
    userEntry("u2", "a1", "main branch"),
    {
      type: "compaction",
      id: "cmp",
      parentId: "u2",
      timestamp: "2026-01-01T00:00:03.000Z",
      summary: "main branch summary",
      firstKeptEntryId: "u2",
      tokensBefore: 100,
    },
    userEntry("alt", "a1", "alternate branch"),
  ];

  const context = buildSessionContext(entries, "alt");

  assert.deepEqual(context.entryIds, ["u1", "a1", "alt"]);
  assert.equal(
    context.messages.some((message) => message.role === "custom"),
    false,
  );
});

test("returns an empty context for a null leaf", () => {
  const context = buildSessionContext([userEntry("u1", null, "not active")], null);

  assert.deepEqual(context.messages, []);
  assert.deepEqual(context.entryIds, []);
});

test("defers historical thinking without changing live-session content", () => {
  const entries = [
    userEntry("u1", null, "start"),
    {
      ...assistantEntry("a1", "u1", "answer"),
      message: {
        role: "assistant",
        provider: "test",
        model: "test-model",
        content: [
          { type: "thinking", thinking: "large reasoning" },
          { type: "text", text: "answer" },
        ],
      },
    },
  ];

  const deferred = buildSessionContext(entries, undefined, { deferThinking: true });
  assert.deepEqual(deferred.messages[1].content[0], {
    type: "thinking",
    thinking: "",
    deferred: true,
  });

  const full = buildSessionContext(entries);
  assert.equal(full.messages[1].content[0].thinking, "large reasoning");
});

test("does not defer empty historical thinking blocks", () => {
  const entries = [
    userEntry("u1", null, "start"),
    {
      ...assistantEntry("a1", "u1", "answer"),
      message: {
        role: "assistant",
        provider: "test",
        model: "test-model",
        content: [
          { type: "thinking", thinking: "" },
          { type: "text", text: "answer" },
        ],
      },
    },
  ];

  const context = buildSessionContext(entries, undefined, { deferThinking: true });
  assert.deepEqual(context.messages[1].content[0], { type: "thinking", thinking: "" });
});

test("defers only base64 images from historical tool results", () => {
  const userImage = {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "QUJDRA==" },
  };
  const toolImage = {
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: "QUJDRA==" },
  };
  const toolUrlImage = {
    type: "image",
    source: { type: "url", url: "https://example.com/result.png" },
  };
  const flatToolImage = {
    type: "image",
    data: "QUJDRA==",
    mimeType: "image/png",
  };
  const entries = [
    userEntry("u1", null, [{ type: "text", text: "inspect this" }, userImage]),
    assistantEntry("a1", "u1", "reading"),
    {
      type: "message",
      id: "tr1",
      parentId: "a1",
      timestamp: "2026-01-01T00:00:01.000Z",
      message: {
        role: "toolResult",
        toolCallId: "call1",
        content: [{ type: "text", text: "Read image file" }, toolImage, flatToolImage, toolUrlImage],
      },
    },
  ];

  const deferred = buildSessionContext(entries, undefined, { deferToolResultImages: true });
  assert.deepEqual(deferred.messages[0].content[1], userImage);
  assert.deepEqual(deferred.messages[2].content[0], { type: "text", text: "Read image file" });
  assert.deepEqual(deferred.messages[2].content[1], toolUrlImage);
  assert.match(deferred.messages[2].content[2].text, /2 tool result images omitted.*image\/jpeg, image\/png.*~8 bytes/);

  const full = buildSessionContext(entries);
  assert.deepEqual(full.messages[2].content[1], toolImage);
  assert.deepEqual(full.messages[2].content[2], flatToolImage);
  assert.deepEqual(full.messages[2].content[3], toolUrlImage);
});

test("preserves hidden custom messages so the UI can render them collapsed", () => {
  const entries = [
    userEntry("u1", null, "start"),
    {
      type: "custom_message",
      id: "c1",
      parentId: "u1",
      timestamp: "2026-01-01T00:00:01.000Z",
      customType: "extension_debug",
      content: "hidden extension payload",
      display: false,
      details: { source: "test" },
    },
    assistantEntry("a1", "c1", "done"),
  ];

  const context = buildSessionContext(entries);

  assert.deepEqual(context.entryIds, ["u1", "c1", "a1"]);
  assert.equal(context.messages[1].role, "custom");
  assert.equal(context.messages[1].customType, "extension_debug");
  assert.equal(context.messages[1].display, false);
  assert.equal(context.messages[1].content, "hidden extension payload");
});

test("preserves valid epoch timestamps on synthetic UI messages", () => {
  const entries = [
    userEntry("u1", null, "start"),
    {
      type: "compaction",
      id: "cmp",
      parentId: "u1",
      timestamp: "1970-01-01T00:00:00.000Z",
      summary: "epoch summary",
      firstKeptEntryId: "u1",
      tokensBefore: 10,
    },
  ];

  const context = buildSessionContext(entries);

  assert.deepEqual(context.entryIds, ["u1", "cmp"]);
  assert.equal(context.messages[1].role, "custom");
  assert.equal(context.messages[1].customType, "compaction");
  assert.equal(context.messages[1].timestamp, 0);
});

test("reads only a bounded session header, including headers larger than 4 KiB", () => {
  const dir = mkdtempSync(join(tmpdir(), "ompdesk-header-"));
  const filePath = join(dir, "session.jsonl");
  const parentSession = `/tmp/${"p".repeat(5_000)}.jsonl`;
  writeFileSync(
    filePath,
    `${JSON.stringify({
      type: "session",
      version: 3,
      id: "session",
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: dir,
      parentSession,
    })}\n${JSON.stringify(userEntry("u1", null, "message"))}\n`,
  );

  try {
    assert.equal(readSessionHeader(filePath)?.parentSession, parentSession);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("returns null for malformed or unbounded session headers", () => {
  const dir = mkdtempSync(join(tmpdir(), "ompdesk-header-invalid-"));
  const malformedPath = join(dir, "malformed.jsonl");
  const oversizedPath = join(dir, "oversized.jsonl");
  writeFileSync(malformedPath, "{not-json}\n");
  writeFileSync(oversizedPath, "x".repeat(64 * 1024));

  try {
    assert.equal(readSessionHeader(malformedPath), null);
    assert.equal(readSessionHeader(oversizedPath), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("keeps forward and reverse session path caches in sync", async () => {
  const sessionId = "cache-test-session";
  const filePath = join(tmpdir(), "ompdesk-cache-test", "..", "cache-test", "session.jsonl");

  cacheSessionPath(sessionId, filePath);
  try {
    assert.equal(await resolveSessionIdByPath(filePath), sessionId);
  } finally {
    invalidateSessionPathCache(sessionId);
  }

  assert.equal(globalThis.__ompSessionPathCache?.has(sessionId), false);
  assert.equal(globalThis.__ompPathToSessionIdCache?.has(sessionPathKey(filePath)), false);
});

test("drops cached paths for transient sessions that were never persisted", async (t) => {
  const sessionId = "transient-cache-test-session";
  const dir = mkdtempSync(join(tmpdir(), "ompdesk-transient-session-"));
  const filePath = join(dir, "session.jsonl");
  const originalListAll = SessionManager.listAll;
  SessionManager.listAll = async () => [];
  resetSessionListState();
  cacheSessionPath(sessionId, filePath);
  t.after(() => {
    SessionManager.listAll = originalListAll;
    invalidateSessionPathCache(sessionId);
    resetSessionListState();
    rmSync(dir, { recursive: true, force: true });
  });

  assert.equal(await resolveSessionPath(sessionId), null);
  assert.equal(globalThis.__ompSessionPathCache?.has(sessionId), false);
});

test("forced session listing bypasses the fresh server cache", async (t) => {
  const originalListAll = SessionManager.listAll;
  let scans = 0;
  SessionManager.listAll = async () => {
    scans += 1;
    return [];
  };
  resetSessionListState();
  t.after(() => {
    SessionManager.listAll = originalListAll;
    resetSessionListState();
  });

  await listAllSessions({ force: true });
  await listAllSessions();
  assert.equal(scans, 1);

  await listAllSessions({ force: true });
  assert.equal(scans, 2);
});

test("a scan invalidated in flight retries before returning to its caller", async (t) => {
  const originalListAll = SessionManager.listAll;
  let scans = 0;
  let releaseFirstScan;
  let markFirstScanStarted;
  const firstScanStarted = new Promise((resolve) => {
    markFirstScanStarted = resolve;
  });
  const firstScanGate = new Promise((resolve) => {
    releaseFirstScan = resolve;
  });
  SessionManager.listAll = async () => {
    scans += 1;
    if (scans === 1) {
      markFirstScanStarted();
      await firstScanGate;
    }
    return [];
  };
  resetSessionListState();
  t.after(() => {
    SessionManager.listAll = originalListAll;
    resetSessionListState();
  });

  const listing = listAllSessions({ force: true });
  await firstScanStarted;
  invalidateSessionListCache();
  releaseFirstScan();
  await listing;

  assert.equal(scans, 2);
});

test("disk sessions replace runtime snapshots with the same id", () => {
  const base = {
    path: "/tmp/session.jsonl",
    id: "same-id",
    cwd: "/tmp",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:01.000Z",
    messageCount: 2,
    firstMessage: "persisted",
  };
  const persisted = { ...base };
  const runtime = {
    ...base,
    path: "/tmp/not-written-yet.jsonl",
    modified: "2026-01-01T00:00:02.000Z",
    firstMessage: "runtime",
    transient: true,
  };
  const runtimeOnly = {
    ...runtime,
    id: "runtime-only",
    modified: "2026-01-01T00:00:03.000Z",
  };

  const merged = mergeSessionLists([persisted], [runtime, runtimeOnly]);

  assert.deepEqual(
    merged.map((session) => session.id),
    ["runtime-only", "same-id"],
  );
  assert.equal(merged[1], persisted);
  assert.equal(merged[1].transient, undefined);
});

test("reads session fields, mtime, and branch parents from real session files", async (t) => {
  const sandbox = createSessionSandbox(t);
  const singleTurnCwd = workspaceDir(sandbox, "single-turn");
  const branchCwd = workspaceDir(sandbox, "branch");
  const emptyCwd = workspaceDir(sandbox, "empty");

  const [singleTurn] = await seedSessions("single-turn", {
    agentDir: sandbox.fixturesAgentDir,
    cwd: singleTurnCwd,
  });
  const [branchParent, ...branchChildren] = await seedSessions("branch", {
    agentDir: sandbox.fixturesAgentDir,
    cwd: branchCwd,
  });
  const [empty] = await seedSessions("empty", { agentDir: sandbox.fixturesAgentDir, cwd: emptyCwd });
  assert.equal(branchChildren.length, 2);

  setSessionModified(singleTurn, "2026-01-04T00:00:00.000Z");
  setSessionModified(branchParent, "2026-01-03T00:00:00.000Z");
  setSessionModified(branchChildren[0], "2026-01-02T00:00:00.000Z");
  setSessionModified(branchChildren[1], "2026-01-01T00:00:00.000Z");
  setSessionModified(empty, "2025-12-31T00:00:00.000Z");

  sandbox.readFixtures();
  const sessions = await listAllSessions({ force: true });
  const byId = new Map(sessions.map((session) => [session.id, session]));

  // listAllSessions 只透传文件 mtime，不负责排序；倒序由 mergeSessionLists 决定。
  assert.deepEqual(
    new Map(sessions.map((session) => [session.id, session.modified])),
    new Map([
      [singleTurn.id, "2026-01-04T00:00:00.000Z"],
      [branchParent.id, "2026-01-03T00:00:00.000Z"],
      [branchChildren[0].id, "2026-01-02T00:00:00.000Z"],
      [branchChildren[1].id, "2026-01-01T00:00:00.000Z"],
      [empty.id, "2025-12-31T00:00:00.000Z"],
    ]),
  );
  assert.deepEqual(
    mergeSessionLists(sessions, []).map((session) => session.id),
    [singleTurn.id, branchParent.id, branchChildren[0].id, branchChildren[1].id, empty.id],
  );

  const singleTurnInfo = byId.get(singleTurn.id);
  assert.equal(singleTurnInfo.cwd, resolve(singleTurnCwd));
  assert.equal(singleTurnInfo.name, singleTurn.title);
  assert.equal(singleTurnInfo.firstMessage, "伪造会话 single-turn 的用户消息");
  assert.equal(singleTurnInfo.modified, "2026-01-04T00:00:00.000Z");
  assert.equal(singleTurnInfo.transient, false);
  assert.equal(singleTurnInfo.parentSessionId, undefined);

  const emptyInfo = byId.get(empty.id);
  assert.equal(emptyInfo.name, empty.title);
  assert.equal(emptyInfo.firstMessage, "(no messages)");
  assert.equal(emptyInfo.messageCount, 0);

  const parentInfo = byId.get(branchParent.id);
  assert.equal(parentInfo.cwd, resolve(branchCwd));
  assert.equal(parentInfo.name, branchParent.title);
  assert.equal(parentInfo.firstMessage, "伪造会话 branch 的用户消息");
  assert.equal(parentInfo.parentSessionId, undefined);

  for (const child of branchChildren) {
    const childInfo = byId.get(child.id);
    assert.equal(childInfo.cwd, resolve(branchCwd));
    assert.equal(childInfo.name, child.title);
    assert.equal(childInfo.firstMessage, "伪造会话 branch 的用户消息");
    assert.equal(childInfo.parentSessionId, branchParent.id);
  }
});

test("derives the omp lifecycle status from real session files", async (t) => {
  const sandbox = createSessionSandbox(t);
  const cwd = workspaceDir(sandbox, "status");

  const [completeSession] = await seedSessions("single-turn", { agentDir: sandbox.fixturesAgentDir, cwd });
  const [interruptedSession] = await seedSessions("tools", { agentDir: sandbox.fixturesAgentDir, cwd });
  const [abortedSession] = await seedSessions("long", { agentDir: sandbox.fixturesAgentDir, cwd });

  // 样本的收尾消息都是正常停下的助手回复。带未回填工具调用的助手消息以 toolUse
  // 停下，让会话停在 interrupted；aborted 停止的助手消息停在 aborted。
  await appendSessionMessage(interruptedSession.path, (timestamp) =>
    assistantTail({
      content: [{ type: "toolCall", id: "call_fixture_status_tail", name: "read", arguments: { path: "README.md" } }],
      stopReason: "toolUse",
      timestamp,
    }),
  );
  await appendSessionMessage(abortedSession.path, (timestamp) =>
    assistantTail({
      content: [{ type: "text", text: "伪造会话 long 的助手回复被中断" }],
      stopReason: "aborted",
      timestamp,
    }),
  );

  sandbox.readFixtures();
  const sessions = await listAllSessions({ force: true });
  const statusById = new Map(sessions.map((session) => [session.id, session.status]));

  assert.equal(statusById.get(completeSession.id), "complete");
  assert.equal(statusById.get(interruptedSession.id), "interrupted");
  assert.equal(statusById.get(abortedSession.id), "aborted");
});

test("a skill-first session titles itself from the command the user typed", async (t) => {
  const sandbox = createSessionSandbox(t);
  const cwd = workspaceDir(sandbox, "skill-command");
  const [seeded] = await seedSessions("skill-command", { agentDir: sandbox.fixturesAgentDir, cwd });
  sandbox.readFixtures();

  const sessions = await listAllSessions({ force: true });
  const info = sessions.find((session) => session.id === seeded.id);
  assert.ok(info, "样本会话应出现在列表里");
  assert.equal(info.firstMessage, "/skill:demo-skill 只回复第一句");
  assert.equal(info.name, seeded.title);
  // 没有存过名字时，标题来自首条消息，而不是助手回复或信封正文。
  assert.equal(sessionDisplayTitle({ ...info, name: undefined }), "/skill:demo-skill 只回复第一句");
});

test("a corrupt session file does not take the whole list down", async (t) => {
  const sandbox = createSessionSandbox(t);
  const cwd = workspaceDir(sandbox, "corrupt");
  const [good] = await seedSessions("single-turn", { agentDir: sandbox.fixturesAgentDir, cwd });
  const brokenDir = join(sandbox.fixturesAgentDir, "sessions", "fixture-broken");
  mkdirSync(brokenDir, { recursive: true });
  writeFileSync(join(brokenDir, "broken.jsonl"), '{"type":"title"}\n{not json\n', "utf8");
  sandbox.readFixtures();

  const sessions = await listAllSessions({ force: true });
  assert.ok(
    sessions.some((session) => session.id === good.id),
    "健康会话仍应出现在列表里",
  );
});

test("an ordinary session keeps its own first message", async (t) => {
  const sandbox = createSessionSandbox(t);
  const cwd = workspaceDir(sandbox, "plain");
  const [seeded] = await seedSessions("single-turn", { agentDir: sandbox.fixturesAgentDir, cwd });
  sandbox.readFixtures();

  const sessions = await listAllSessions({ force: true });
  const info = sessions.find((session) => session.id === seeded.id);
  assert.equal(info.firstMessage, "伪造会话 single-turn 的用户消息");
});
