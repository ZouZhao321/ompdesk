import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../lib/agent-client.ts", import.meta.url), "utf8");
const memorySource = await readFile(new URL("../lib/workspace-memory.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("useAgentSession.ts", source, ts.ScriptTarget.Latest, true);
const callbacks = new Map();
function collect(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
    && node.initializer && ts.isCallExpression(node.initializer)
    && node.initializer.expression.getText(ast) === "useCallback") {
    callbacks.set(node.name.text, node.initializer.arguments[0].getText(ast));
  }
  if (ts.isBinaryExpression(node) && node.left.getText(ast) === "runtimeIdRef.onIdentity") {
    callbacks.set("onIdentity", node.right.getText(ast));
  }
  ts.forEachChild(node, collect);
}
collect(ast);

// Run production callback bodies and modules, removing TypeScript syntax only.
// All identity/retry/storage decisions remain in production code. Each harness
// gets its own fetch and sessionStorage, without patching shared browser globals.
function callback(name, bindings) {
  assert.ok(callbacks.has(name), `Missing callback: ${name}`);
  const { outputText } = ts.transpileModule(`const callback = ${callbacks.get(name)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  });
  return new Function(...Object.keys(bindings), `${outputText}\nreturn callback;`)(...Object.values(bindings));
}

function productionModule(source, bindings, dependencies = {}) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const exports = {};
  const require = (name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  };
  new Function("exports", "require", ...Object.keys(bindings), outputText)(
    exports, require, ...Object.values(bindings),
  );
  return exports;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const context = (label, identity = { sessionId: "b", runtimeId: "runtime:r1" }) => ({
  ...identity,
  context: {
    messages: [{ role: "user", content: label }],
    entryIds: [`${label}-entry`],
  },
  contextUsage: { percent: 73, contextWindow: 1000, tokens: 730 },
});

function harness() {
  const effects = [];
  const storage = new Map();
  const memory = productionModule(memorySource, {
    window: { sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value); effects.push(["storage:set", key, value]); },
      removeItem: (key) => { storage.delete(key); effects.push(["storage:remove", key]); },
    } },
  });
  memory.rememberSessionContinuation("b", "runtime:r1");
  effects.length = 0;
  const ui = {
    Messages: [{ role: "user", content: "current messages" }],
    EntryIds: ["current-entry"],
    ContextUsage: { percent: 10, contextWindow: 1000, tokens: 100 },
    ActiveLeafId: "current-leaf",
    Data: null,
    Loading: false,
    Error: null,
    ThinkingLevel: "off",
    EffectiveThinkingLevel: undefined,
    CurrentModelOverride: null,
  };
  const bindings = {
    mountedRef: { current: true },
    sessionIdRef: { current: "b" },
    runtimeIdRef: { current: "runtime:r1" },
    identityDraftKeyRef: { current: "b" },
    contextRequestRef: { current: 0 },
    historyRequestRef: { current: 0 },
    modelSwitchPendingRef: { current: false },
    eventConnectionAttemptRef: { current: null },
    eventSourceRef: { current: null },
    eventSourceSessionIdRef: { current: "b" },
    eventSourceRuntimeIdRef: { current: null },
    bashRunningRef: { current: false },
    // 跟随入口由 applyFollowRef 转发，这里只记下事件，不跑真的滚动。
    applyFollowRef: { current: (event) => effects.push(["follow", event]) },
    // 最近一次请求的叶子；点同一节点时要靠它跳过重载。
    activeLeafIdRef: { current: null },
    // 最近一次真的载入成功的叶子：载入失败的退回目标。
    appliedLeafIdRef: { current: null },
    opts: {},
    closeEvents: () => effects.push(["closeEvents"]),
    onSessionForked: (...args) => effects.push(["identity", ...args]),
    rememberSessionContinuation: memory.rememberSessionContinuation,
    clearSessionContinuation: memory.clearSessionContinuation,
    console: { error: (...args) => effects.push(["error", ...args]) },
    fetch: () => { throw new Error("Unexpected request"); },
  };
  for (const field of Object.keys(ui)) {
    bindings[`set${field}`] = (value) => {
      ui[field] = typeof value === "function" ? value(ui[field]) : value;
      effects.push([field, ui[field]]);
    };
  }
  const client = productionModule(clientSource, { fetch: (...args) => bindings.fetch(...args) }, {
    "./workspace-memory": memory,
  });
  const commands = [];
  bindings.canApplySessionIdentity = client.canApplySessionIdentity;
  bindings.sendAgentCommand = (...args) => {
    const command = client.sendAgentCommand(...args);
    commands.push(command);
    return command;
  };
  bindings.followSessionIdentity = callback("followSessionIdentity", bindings);
  // 叶子只有一个写入口：状态与去重用的 ref 由它一起写，测试跑的是同一份代码。
  bindings.applyActiveLeaf = callback("applyActiveLeaf", bindings);
  bindings.runtimeIdRef.onIdentity = callback("onIdentity", bindings);
  // 只载入正文、不落运行态：这条路径不需要 state 请求。
  bindings.followRuntimeState = () => false;
  // 回底票号由 hook 的 effect 消费；这里只记下每次请求的值。
  let followTicket = 0;
  bindings.setContextFollowTicket = (update) => {
    followTicket = typeof update === "function" ? update(followTicket) : update;
    effects.push(["followTicket", followTicket]);
  };
  // Use an indirection only for fetch so responses can be scheduled per test.
  const callbackBindings = { ...bindings, fetch: (...args) => bindings.fetch(...args) };
  bindings.loadSession = callback("loadSession", callbackBindings);
  bindings.loadContext = callback("loadContext", callbackBindings);
  bindings.handleNavigate = callback("handleNavigate", bindings);
  bindings.handleLeafChange = callback("handleLeafChange", bindings);
  return { bindings, commands, effects, memory, storage, ui };
}

function snapshot(h) {
  return structuredClone({
    sessionId: h.bindings.sessionIdRef.current,
    runtimeId: h.bindings.runtimeIdRef.current,
    storage: [...h.storage],
    ui: h.ui,
  });
}

for (const [label, identity] of [
  ["explicit null runtime", { sessionId: "b", runtimeId: null }],
  ["missing runtime", { sessionId: "b" }],
  ["old live runtime", { sessionId: "b", runtimeId: "runtime:r1" }],
]) {
  test(`navigation ignores delayed context with ${label} after its command reopens B/R2`, async () => {
    const h = harness();
    const expiredCommand = deferred();
    const oldContext = deferred();
    const contextRequested = deferred();
    const requests = [];
    h.bindings.fetch = async (url, options) => {
      requests.push({ url, command: options ? JSON.parse(options.body) : null });
      if (url === "/api/agent/runtime%3Ar1") return expiredCommand.promise;
      if (url === "/api/agent/b") {
        return response({ success: true, data: {}, sessionId: "b", runtimeId: "runtime:r2" });
      }
      assert.equal(url, "/api/sessions/runtime%3Ar1/context?deferThinking=1&deferMedia=1&leafId=old-leaf");
      return { ok: true, json: () => { contextRequested.resolve(); return oldContext.promise; } };
    };

    const navigating = h.bindings.handleNavigate("old-leaf");
    await contextRequested.promise;
    expiredCommand.resolve(response({
      error: "Runtime session expired", code: "runtime_expired", accepted: false, sessionId: "b",
    }, 404));
    await Promise.all(h.commands);
    assert.equal(h.bindings.runtimeIdRef.current, "runtime:r2");
    assert.equal(h.memory.getSessionContinuation("b"), "runtime:r2");
    assert.equal(h.bindings.contextRequestRef.current, 1, "same-transcript reopening keeps the context request number");
    assert.deepEqual(requests, [
      { url: "/api/agent/runtime%3Ar1", command: { type: "navigate_tree", targetId: "old-leaf" } },
      { url: "/api/sessions/runtime%3Ar1/context?deferThinking=1&deferMedia=1&leafId=old-leaf", command: null },
      { url: "/api/agent/b", command: { type: "navigate_tree", targetId: "old-leaf" } },
    ]);
    const reopened = snapshot(h);
    h.effects.length = 0;

    // The response body completes only after the production expiry retry has
    // rebound the same transcript to R2 and persisted that continuation.
    oldContext.resolve(context("obsolete branch", identity));
    await navigating;
    assert.deepEqual(snapshot(h), reopened, "stale context must not clear R2 or replace its UI/storage");
    assert.deepEqual(h.effects, [], "stale context must not notify the parent or invoke any setter");
  });
}

test("an owned expired runtime still clears its continuation and applies historical context", async () => {
  const h = harness();
  const historical = context("historical", { sessionId: "b", runtimeId: null });
  h.bindings.fetch = async () => response(historical);
  assert.equal(await h.bindings.loadContext("b", null), "applied");
  assert.equal(h.bindings.runtimeIdRef.current, null);
  assert.equal(h.memory.getSessionContinuation("b"), undefined);
  assert.deepEqual(h.ui.Messages, historical.context.messages);
  assert.deepEqual(h.ui.EntryIds, historical.context.entryIds);
  assert.deepEqual(h.ui.ContextUsage, historical.contextUsage);
  assert.ok(h.effects.some(([kind, sessionId, runtimeId]) => kind === "identity" && sessionId === "b" && runtimeId === null));
});

test("a same-runtime context response still applies its messages, entry IDs and usage", async () => {
  const h = harness();
  const current = context("owned branch");
  h.bindings.fetch = async () => response(current);
  assert.equal(await h.bindings.loadContext("b", "owned-leaf"), "applied");
  assert.equal(h.bindings.runtimeIdRef.current, "runtime:r1");
  assert.equal(h.memory.getSessionContinuation("b"), "runtime:r1");
  assert.deepEqual(h.ui.Messages, current.context.messages);
  assert.deepEqual(h.ui.EntryIds, current.context.entryIds);
  assert.deepEqual(h.ui.ContextUsage, current.contextUsage);
  assert.equal(h.effects.some(([kind]) => kind === "identity" || kind === "storage:remove"), false);
});

test("treats a finished branch reload as a jump to the bottom", async () => {
  const h = harness();
  h.bindings.fetch = async () => response(context("other branch"));
  assert.equal(await h.bindings.loadContext("b", "other-leaf"), "applied");
  // 切分支/叶是整段替换消息，列表既不重挂也不走追加跟随；重新载入成功就记一张回底
  // 票号。滚动不在这里做：此刻新消息还没提交，量到的是旧列表的高度，落点会停在
  // 旧末端，交给提交后的 effect。
  assert.deepEqual(h.effects.filter(([kind]) => kind === "follow"), []);
  assert.deepEqual(h.effects.filter(([kind]) => kind === "followTicket"), [["followTicket", 1]]);
});

test("clicking the already active leaf neither reloads nor pulls the view to the end", async () => {
  const h = harness();
  h.bindings.activeLeafIdRef.current = "current-leaf";
  const before = snapshot(h);
  h.bindings.fetch = () => { throw new Error("the active leaf must not be reloaded"); };

  await h.bindings.handleLeafChange("current-leaf");

  // 叶子没变：不重载、不记回底票号、也不把导航命令再送一遍。视图停在用户上滚到的
  // 位置，不会被拽回末尾。
  assert.deepEqual(snapshot(h), before);
  assert.deepEqual(h.effects, []);
  assert.deepEqual(h.commands, []);
});

test("switching to another leaf reloads it and requests the follow after commit", async () => {
  const h = harness();
  h.bindings.activeLeafIdRef.current = "current-leaf";
  h.bindings.fetch = async (url) => {
    if (String(url).startsWith("/api/agent/")) {
      return response({ success: true, data: {}, sessionId: "b", runtimeId: "runtime:r1" });
    }
    return response(context("other branch"));
  };

  await h.bindings.handleLeafChange("other-leaf");
  await Promise.all(h.commands);

  // 叶子真的变了：载入新分支、记下新叶子，回底等到提交之后。
  assert.equal(h.bindings.activeLeafIdRef.current, "other-leaf");
  assert.equal(h.ui.ActiveLeafId, "other-leaf");
  assert.deepEqual(h.ui.Messages, [{ role: "user", content: "other branch" }]);
  assert.deepEqual(h.effects.filter(([kind]) => kind === "followTicket"), [["followTicket", 1]]);
  assert.equal(h.commands.length, 1);
});

test("an owned same-runtime relocation still follows its new transcript", async () => {
  const h = harness();
  const relocated = context("relocated", { sessionId: "c", runtimeId: "runtime:r1" });
  h.bindings.fetch = async () => response(relocated);
  assert.equal(await h.bindings.loadContext("b", "owned-leaf"), "applied");
  assert.equal(h.bindings.sessionIdRef.current, "c");
  assert.equal(h.bindings.runtimeIdRef.current, "runtime:r1");
  assert.equal(h.memory.getSessionContinuation("c"), "runtime:r1");
  assert.deepEqual(h.ui.Messages, relocated.context.messages);
});

test("a newer context request owns the UI even when the runtime stays the same", async () => {
  const h = harness();
  const older = deferred();
  const requested = deferred();
  const latest = context("latest branch");
  h.bindings.fetch = async (url) => {
    if (url.endsWith("leafId=old-leaf")) {
      return { ok: true, json: () => { requested.resolve(); return older.promise; } };
    }
    assert.ok(url.endsWith("leafId=latest-leaf"));
    return response(latest);
  };
  const loadingOld = h.bindings.loadContext("b", "old-leaf");
  await requested.promise;
  assert.equal(await h.bindings.loadContext("b", "latest-leaf"), "applied");
  assert.deepEqual(h.ui.Messages, latest.context.messages);
  const newest = snapshot(h);
  h.effects.length = 0;
  older.resolve(context("obsolete", { sessionId: "b", runtimeId: null }));
  assert.equal(await loadingOld, "stale");
  assert.deepEqual(snapshot(h), newest);
  assert.deepEqual(h.effects, []);
});

for (const superseded of ["different session selection", "unmount"]) {
  test(`context does not apply after ${superseded}`, async () => {
    const h = harness();
    const older = deferred();
    const requested = deferred();
    h.bindings.fetch = async () => ({
      ok: true, json: () => { requested.resolve(); return older.promise; },
    });
    const loading = h.bindings.loadContext("b", "old-leaf");
    await requested.promise;
    if (superseded === "unmount") h.bindings.mountedRef.current = false;
    else h.bindings.followSessionIdentity("c", "runtime:r2");
    const current = snapshot(h);
    h.effects.length = 0;
    older.resolve(context("obsolete", { sessionId: "b", runtimeId: null }));
    assert.equal(await loading, "stale");
    assert.deepEqual(snapshot(h), current);
    assert.deepEqual(h.effects, []);
  });
}

test("a fresh load records the leaf it landed on, so clicking that leaf changes nothing", async () => {
  const h = harness();
  h.bindings.fetch = async () => response({
    sessionId: "b",
    runtimeId: "runtime:r1",
    leafId: "current-leaf",
    context: { messages: [{ role: "user", content: "loaded" }], entryIds: ["loaded-entry"] },
  });

  await h.bindings.loadSession("b", true);

  // 载入就是一次真实的叶子切换：状态与去重用的 ref 一起写。
  assert.equal(h.ui.ActiveLeafId, "current-leaf");
  assert.equal(h.bindings.activeLeafIdRef.current, "current-leaf");
  h.effects.length = 0;
  h.bindings.fetch = () => { throw new Error("the loaded leaf must not be reloaded"); };

  await h.bindings.handleLeafChange(h.ui.ActiveLeafId);

  // 首屏落到的就是这条分支：再点一次不重载、不记回底票号，视图留在原处。
  assert.deepEqual(h.effects, []);
  assert.deepEqual(h.commands, []);
});

test("a missing session clears the recorded leaf together with the state", async () => {
  const h = harness();
  h.bindings.activeLeafIdRef.current = "current-leaf";
  h.bindings.fetch = async () => response(null, 404);

  await h.bindings.loadSession("b", true);

  assert.equal(h.ui.ActiveLeafId, null);
  assert.equal(h.bindings.activeLeafIdRef.current, null);
});

test("a navigation already under way is not reloaded by a click on the same leaf", async () => {
  const h = harness();
  const started = deferred();
  const pending = deferred();
  let contextRequests = 0;
  h.bindings.fetch = async (url) => {
    if (String(url).startsWith("/api/agent/")) {
      return response({ success: true, data: {}, sessionId: "b", runtimeId: "runtime:r1" });
    }
    contextRequests += 1;
    assert.equal(contextRequests, 1, "the leaf already being loaded must not be reloaded");
    started.resolve();
    return { ok: true, json: () => pending.promise };
  };

  const navigating = h.bindings.handleNavigate("target-leaf");
  await started.promise;
  h.effects.length = 0;

  // 载入还挂着，叶子标记已经落在新叶子上：再点这一叶不该另起一次整段载入。
  await h.bindings.handleLeafChange("target-leaf");
  assert.deepEqual(h.effects, []);

  pending.resolve(context("target"));
  await navigating;
  await Promise.all(h.commands);
  assert.equal(h.bindings.activeLeafIdRef.current, "target-leaf");
  assert.deepEqual(h.ui.Messages, [{ role: "user", content: "target" }]);
});

/** 只有命令接口有响应：整段载入按 status 失败。 */
function failingContext(status) {
  return async (url) => {
    if (String(url).startsWith("/api/agent/")) {
      return response({ success: true, data: {}, sessionId: "b", runtimeId: "runtime:r1" });
    }
    return response(null, status);
  };
}

test("a failed branch click puts the leaf state and the dedupe marker back together", async () => {
  const h = harness();
  h.bindings.activeLeafIdRef.current = "current-leaf";
  h.bindings.fetch = failingContext(500);

  await h.bindings.handleLeafChange("broken-leaf");

  // 载入失败：状态与去重用的 ref 一起退回原叶子。只写状态、成功后才写 ref 会让两者
  // 分叉，之后点原叶子被去重判据吞掉——既不重载也不发命令。
  assert.equal(h.ui.ActiveLeafId, "current-leaf");
  assert.equal(h.bindings.activeLeafIdRef.current, "current-leaf");
  assert.deepEqual(h.commands, [], "a leaf that never loaded must not be navigated to");

  // 退回之后这条分支还能再点一次，去重判据不会把重试吞掉。
  h.effects.length = 0;
  h.bindings.fetch = async (url) => (String(url).startsWith("/api/agent/")
    ? response({ success: true, data: {}, sessionId: "b", runtimeId: "runtime:r1" })
    : response(context("recovered branch")));
  await h.bindings.handleLeafChange("broken-leaf");
  await Promise.all(h.commands);

  assert.equal(h.ui.ActiveLeafId, "broken-leaf");
  assert.equal(h.bindings.activeLeafIdRef.current, "broken-leaf");
  assert.deepEqual(h.ui.Messages, [{ role: "user", content: "recovered branch" }]);
});

test("a failed entry navigation rolls the leaf back with the marker", async () => {
  const h = harness();
  h.bindings.activeLeafIdRef.current = "current-leaf";
  h.bindings.fetch = failingContext(503);

  await h.bindings.handleNavigate("broken-leaf");
  await Promise.all(h.commands);

  // 两条导航路径同一时机：先写、失败一起退。界面不会停在一条没载入的分支上。
  assert.equal(h.ui.ActiveLeafId, "current-leaf");
  assert.equal(h.bindings.activeLeafIdRef.current, "current-leaf");
  assert.deepEqual(h.ui.Messages, [{ role: "user", content: "current messages" }]);
});
