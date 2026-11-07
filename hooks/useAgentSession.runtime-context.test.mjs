import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { callback } from "./useAgentSession.test-support.mjs";

const clientSource = await readFile(new URL("../lib/agent-client.ts", import.meta.url), "utf8");
const memorySource = await readFile(new URL("../lib/workspace-memory.ts", import.meta.url), "utf8");

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
    exports,
    require,
    ...Object.values(bindings),
  );
  return exports;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
// 一次整段载入的响应体（不是 fetch 响应）：叶子、正文与 entryIds 一起给出。
const sessionSnapshot = (leafId, label) => ({
  sessionId: "b",
  runtimeId: "runtime:r1",
  leafId,
  context: { messages: [{ role: "user", content: label }], entryIds: [`${label}-entry`] },
});
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
    window: {
      sessionStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => {
          storage.set(key, value);
          effects.push(["storage:set", key, value]);
        },
        removeItem: (key) => {
          storage.delete(key);
          effects.push(["storage:remove", key]);
        },
      },
    },
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
    // 运行时确认停在上面的叶子：只在导航命令成功后写。
    runtimeLeafIdRef: { current: null },
    // 在途导航的目标叶子；外层对象把「没有导航」与「正导航到分支根(null)」分开。
    navigatingLeafRef: { current: null },
    // 导航代数：每开始一次导航 +1，整段载入靠它判断自己的提交是否过期。
    navigationGenerationRef: { current: 0 },
    opts: {},
    // 界面文案由组件注入；这里按词条给出英文，回执断言保持可读。
    t: (key) =>
      ({
        "chat.branchLoadFailed": "Failed to load the selected branch",
        "chat.branchSwitchFailed": "Failed to switch branch",
      })[key] ?? key,
    addNotice: (notice) => effects.push(["notice", notice]),
    closeEvents: () => effects.push(["closeEvents"]),
    onSessionForked: (...args) => effects.push(["identity", ...args]),
    rememberSessionContinuation: memory.rememberSessionContinuation,
    clearSessionContinuation: memory.clearSessionContinuation,
    console: { error: (...args) => effects.push(["error", ...args]) },
    fetch: () => {
      throw new Error("Unexpected request");
    },
  };
  for (const field of Object.keys(ui)) {
    bindings[`set${field}`] = (value) => {
      ui[field] = typeof value === "function" ? value(ui[field]) : value;
      effects.push([field, ui[field]]);
    };
  }
  const client = productionModule(
    clientSource,
    { fetch: (...args) => bindings.fetch(...args) },
    {
      "./workspace-memory": memory,
    },
  );
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
  bindings.loadSessionRef = { current: null };
  const callbackBindings = { ...bindings, fetch: (...args) => bindings.fetch(...args) };
  bindings.loadSession = callback("loadSession", callbackBindings);
  bindings.loadSessionRef.current = bindings.loadSession;
  bindings.loadContext = callback("loadContext", callbackBindings);
  bindings.settleContextNavigation = callback("settleContextNavigation", bindings);
  // 两条导航路径共用同一个运行时搬移：命令成功才写运行时确认值，失败只留回执。
  bindings.moveRuntimeLeaf = callback("moveRuntimeLeaf", bindings);
  // 两条导航路径共用同一个生命周期：先取到真实的导航入口再交给两条轻量入口。
  bindings.runNavigation = callback("runNavigation", bindings);
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
  test(`navigation drops a delayed context after the runtime reopens with ${label}`, async () => {
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
      assert.equal(
        url,
        "/api/sessions/runtime%3Ar1/context?deferThinking=1&deferMedia=1&leafId=old-leaf",
      );
      return {
        ok: true,
        json: () => {
          contextRequested.resolve();
          return oldContext.promise;
        },
      };
    };

    // 载入先发：跳转条等载入应用之后才动运行时。
    const navigating = h.bindings.handleNavigate("old-leaf");
    await contextRequested.promise;
    // 载入在途期间，另一个命令撞上过期句柄，把同一个会话重绑到 R2。
    const reopening = h.bindings.sendAgentCommand(
      "b",
      { type: "navigate_tree", targetId: "old-leaf" },
      h.bindings.runtimeIdRef,
    );
    expiredCommand.resolve(
      response(
        {
          error: "Runtime session expired",
          code: "runtime_expired",
          accepted: false,
          sessionId: "b",
        },
        404,
      ),
    );
    await reopening;
    assert.equal(h.bindings.runtimeIdRef.current, "runtime:r2");
    assert.equal(h.memory.getSessionContinuation("b"), "runtime:r2");
    assert.equal(
      h.bindings.contextRequestRef.current,
      1,
      "same-transcript reopening keeps the context request number",
    );
    assert.deepEqual(requests, [
      {
        url: "/api/sessions/runtime%3Ar1/context?deferThinking=1&deferMedia=1&leafId=old-leaf",
        command: null,
      },
      { url: "/api/agent/runtime%3Ar1", command: { type: "navigate_tree", targetId: "old-leaf" } },
      { url: "/api/agent/b", command: { type: "navigate_tree", targetId: "old-leaf" } },
    ]);
    const reopened = snapshot(h);
    const commandsBefore = h.commands.length;
    h.effects.length = 0;

    // The response body completes only after the production expiry retry has
    // rebound the same transcript to R2 and persisted that continuation.
    oldContext.resolve(context("obsolete branch", identity));
    await navigating;
    // 运行时被重绑，这次载入作废，而且没有更晚的载入来纠正叶子：退回最近一次真的
    // 载入成功过的值（这里一次都没有，因此是 null）。留在 old-leaf 上会让去重判据
    // 从此吞掉对它的重试。
    assert.equal(h.bindings.sessionIdRef.current, "b");
    assert.equal(h.bindings.runtimeIdRef.current, "runtime:r2");
    assert.equal(h.memory.getSessionContinuation("b"), "runtime:r2");
    assert.deepEqual(
      [...h.storage],
      reopened.storage,
      "a stale context must not touch the stored continuation",
    );
    assert.deepEqual(
      h.ui.Messages,
      reopened.ui.Messages,
      "a stale context must not replace the transcript",
    );
    assert.equal(h.ui.ActiveLeafId, null);
    assert.equal(h.bindings.activeLeafIdRef.current, null);
    assert.deepEqual(
      h.effects,
      [["ActiveLeafId", null]],
      "the stale navigation only rolls its own leaf marker back",
    );
    assert.equal(
      h.commands.length,
      commandsBefore,
      "a stale navigation must not move the runtime leaf",
    );
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
  assert.ok(
    h.effects.some(
      ([kind, sessionId, runtimeId]) =>
        kind === "identity" && sessionId === "b" && runtimeId === null,
    ),
  );
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
  assert.equal(
    h.effects.some(([kind]) => kind === "identity" || kind === "storage:remove"),
    false,
  );
});

test("treats a finished branch reload as a jump to the bottom", async () => {
  const h = harness();
  h.bindings.fetch = async () => response(context("other branch"));
  assert.equal(await h.bindings.loadContext("b", "other-leaf"), "applied");
  // 切分支/叶是整段替换消息，列表既不重挂也不走追加跟随；重新载入成功就记一张回底
  // 票号。滚动不在这里做：此刻新消息还没提交，量到的是旧列表的高度，落点会停在
  // 旧末端，交给提交后的 effect。
  assert.deepEqual(
    h.effects.filter(([kind]) => kind === "follow"),
    [],
  );
  assert.deepEqual(
    h.effects.filter(([kind]) => kind === "followTicket"),
    [["followTicket", 1]],
  );
});

test("clicking the already active leaf neither reloads nor pulls the view to the end", async () => {
  const h = harness();
  h.bindings.activeLeafIdRef.current = "current-leaf";
  // 一次整段载入同时写下高亮与运行时确认值；只有两者都指向这一叶才跳过重载。
  h.bindings.runtimeLeafIdRef.current = "current-leaf";
  const before = snapshot(h);
  h.bindings.fetch = () => {
    throw new Error("the active leaf must not be reloaded");
  };

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
  assert.deepEqual(
    h.effects.filter(([kind]) => kind === "followTicket"),
    [["followTicket", 1]],
  );
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
      return {
        ok: true,
        json: () => {
          requested.resolve();
          return older.promise;
        },
      };
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
  assert.equal(await loadingOld, "superseded");
  assert.deepEqual(snapshot(h), newest);
  assert.deepEqual(h.effects, []);
});

for (const [superseded, outcome] of [
  // 换会话由 followSessionIdentity 换掉请求号，旧响应归那次新载入，属于被接管。
  ["different session selection", "superseded"],
  // 卸载没有更晚的载入来接，这次结果只是作废。
  ["unmount", "invalidated"],
]) {
  test(`context does not apply after ${superseded}`, async () => {
    const h = harness();
    const older = deferred();
    const requested = deferred();
    h.bindings.fetch = async () => ({
      ok: true,
      json: () => {
        requested.resolve();
        return older.promise;
      },
    });
    const loading = h.bindings.loadContext("b", "old-leaf");
    await requested.promise;
    if (superseded === "unmount") h.bindings.mountedRef.current = false;
    else h.bindings.followSessionIdentity("c", "runtime:r2");
    const current = snapshot(h);
    h.effects.length = 0;
    older.resolve(context("obsolete", { sessionId: "b", runtimeId: null }));
    assert.equal(await loading, outcome);
    assert.deepEqual(snapshot(h), current);
    assert.deepEqual(h.effects, []);
  });
}

test("a fresh load records the leaf it landed on, so clicking that leaf changes nothing", async () => {
  const h = harness();
  h.bindings.fetch = async () =>
    response({
      sessionId: "b",
      runtimeId: "runtime:r1",
      leafId: "current-leaf",
      context: { messages: [{ role: "user", content: "loaded" }], entryIds: ["loaded-entry"] },
    });

  await h.bindings.loadSession("b", true);

  // 载入就是一次真实的叶子切换：状态与去重用的 ref 一起写，运行时确认值跟着落到
  // 同一叶上——它确实来自运行态。
  assert.equal(h.ui.ActiveLeafId, "current-leaf");
  assert.equal(h.bindings.activeLeafIdRef.current, "current-leaf");
  assert.equal(h.bindings.runtimeLeafIdRef.current, "current-leaf");
  h.effects.length = 0;
  h.bindings.fetch = () => {
    throw new Error("the loaded leaf must not be reloaded");
  };

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
  assert.equal(h.bindings.runtimeLeafIdRef.current, null);
});

test("a branch that lands first is not pulled back by an older session load", async () => {
  const h = harness();
  const historyRequested = deferred();
  const historyBody = deferred();
  const navigationRequested = deferred();
  const navigationBody = deferred();
  let historyCount = 0;
  h.bindings.fetch = async (url) => {
    if (String(url).startsWith("/api/agent/")) {
      return response({ success: true, data: {}, sessionId: "b", runtimeId: "runtime:r1" });
    }
    if (String(url).includes("/context?")) {
      navigationRequested.resolve();
      return { ok: true, json: () => navigationBody.promise };
    }
    historyCount += 1;
    if (historyCount === 1) {
      historyRequested.resolve();
      return { ok: true, json: () => historyBody.promise };
    }
    // 让位后的重发读的是导航落定后的视图。
    return response({
      sessionId: "b",
      runtimeId: "runtime:r1",
      leafId: "target-leaf",
      context: { messages: [{ role: "user", content: "target" }], entryIds: ["target-entry"] },
    });
  };

  // agent_end / prompt_done 触发的整段载入先发出。
  const loading = h.bindings.loadSession("b", true);
  await historyRequested.promise;
  // 载入在途时用户点了另一条分支，导航先落定。
  const navigating = h.bindings.handleNavigate("target-leaf");
  await navigationRequested.promise;
  navigationBody.resolve(context("target"));
  await navigating;
  await Promise.all(h.commands);

  // 慢一步的持久化视图随后到达：叶子与正文都归那次导航，不许把它们拉回旧值。
  historyBody.resolve(
    response({
      sessionId: "b",
      runtimeId: "runtime:r1",
      leafId: "persisted-leaf",
      context: {
        messages: [{ role: "user", content: "persisted" }],
        entryIds: ["persisted-entry"],
      },
    }),
  );
  assert.equal(await loading, null);
  // 让位的那次载入会重发一次：等重发落地后，最终仍停在导航的目标分支上。
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(historyCount, 2);
  assert.equal(h.ui.ActiveLeafId, "target-leaf");
  assert.equal(h.bindings.activeLeafIdRef.current, "target-leaf");
  assert.equal(h.bindings.appliedLeafIdRef.current, "target-leaf");
  assert.equal(h.bindings.runtimeLeafIdRef.current, "target-leaf");
  assert.deepEqual(h.ui.Messages, [{ role: "user", content: "target" }]);
  assert.deepEqual(h.ui.EntryIds, ["target-entry"]);
});

test("a session load issued while a branch is loading is replayed once the navigation settles", async () => {
  const h = harness();
  const navigationRequested = deferred();
  const navigationBody = deferred();
  const historyRequests = [];
  h.bindings.fetch = async (url) => {
    if (String(url).startsWith("/api/agent/")) {
      return response({ success: true, data: {}, sessionId: "b", runtimeId: "runtime:r1" });
    }
    if (String(url).includes("/context?")) {
      navigationRequested.resolve();
      return { ok: true, json: () => navigationBody.promise };
    }
    const body = deferred();
    historyRequests.push(body);
    return { ok: true, json: () => body.promise };
  };

  // 导航挂着、高亮已经写在目标叶上，agent_end 此时才触发这次整段载入。
  const navigating = h.bindings.handleNavigate("target-leaf");
  await navigationRequested.promise;
  const loading = h.bindings.loadSession("b", true);
  assert.equal(historyRequests.length, 1);
  historyRequests[0].resolve(sessionSnapshot("persisted-leaf", "persisted"));

  // 让位与失败分开报：这次没有回写，但导航收尾会补发，命令侧的门控不会凭空消失。
  assert.deepEqual(await loading, { deferred: true });
  // 导航还没落定：叶子与正文归它，载入不许抢在它前面写一遍持久化值。
  assert.equal(h.ui.ActiveLeafId, "target-leaf");
  assert.equal(h.bindings.activeLeafIdRef.current, "target-leaf");
  assert.equal(h.bindings.appliedLeafIdRef.current, null);
  assert.deepEqual(h.ui.Messages, [{ role: "user", content: "current messages" }]);
  assert.equal(historyRequests.length, 1);

  navigationBody.resolve(context("target"));
  await navigating;
  await Promise.all(h.commands);
  assert.equal(h.bindings.appliedLeafIdRef.current, "target-leaf");
  assert.deepEqual(h.ui.Messages, [{ role: "user", content: "target" }]);
  // 导航落定后补发一次：读到的正是导航写下的持久化视图，正文与 entryIds 一起跟上。
  assert.equal(historyRequests.length, 2);
  historyRequests[1].resolve(sessionSnapshot("target-leaf", "target"));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(h.bindings.appliedLeafIdRef.current, "target-leaf");
  assert.equal(h.bindings.activeLeafIdRef.current, "target-leaf");
  assert.equal(h.bindings.runtimeLeafIdRef.current, "target-leaf");
  assert.deepEqual(h.ui.Messages, [{ role: "user", content: "target" }]);
  assert.deepEqual(h.ui.EntryIds, ["target-entry"]);
});

test("every refresh swallowed by the same navigation is replayed exactly once", async () => {
  const h = harness();
  const navigationRequested = deferred();
  const navigationBody = deferred();
  const historyRequests = [];
  h.bindings.fetch = async (url) => {
    if (String(url).startsWith("/api/agent/")) {
      return response({ success: true, data: {}, sessionId: "b", runtimeId: "runtime:r1" });
    }
    if (String(url).includes("/context?")) {
      navigationRequested.resolve();
      return { ok: true, json: () => navigationBody.promise };
    }
    const body = deferred();
    historyRequests.push(body);
    return { ok: true, json: () => body.promise };
  };

  const navigating = h.bindings.handleNavigate("target-leaf");
  await navigationRequested.promise;
  // 导航在途时先后到达的两条刷新：/compact 与 agent_end 各发一次整段载入。
  const compacted = h.bindings.loadSession("b", true);
  assert.equal(historyRequests.length, 1);
  historyRequests[0].resolve(sessionSnapshot("persisted-leaf", "persisted"));
  assert.deepEqual(await compacted, { deferred: true });

  const settled = h.bindings.loadSession("b");
  assert.equal(historyRequests.length, 2);
  historyRequests[1].resolve(sessionSnapshot("persisted-leaf", "persisted"));
  assert.deepEqual(await settled, { deferred: true });
  assert.deepEqual(h.ui.Messages, [{ role: "user", content: "current messages" }]);

  navigationBody.resolve(context("target"));
  await navigating;
  await Promise.all(h.commands);
  // 两次让位合并成一次补发：导航落定后重读一份视图，不是每让一次就补一次。
  assert.equal(historyRequests.length, 3);
  historyRequests[2].resolve({
    sessionId: "b",
    runtimeId: "runtime:r1",
    leafId: "target-leaf",
    context: {
      messages: [
        { role: "user", content: "target" },
        { role: "assistant", content: "compacted" },
      ],
      entryIds: ["target-entry", "compacted-entry"],
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(h.ui.Messages, [
    { role: "user", content: "target" },
    { role: "assistant", content: "compacted" },
  ]);
  assert.deepEqual(h.ui.EntryIds, ["target-entry", "compacted-entry"]);
  assert.equal(h.bindings.appliedLeafIdRef.current, "target-leaf");
});

test("a deferred reload is replayed with its agent state read", async () => {
  const h = harness();
  const navigationRequested = deferred();
  const navigationBody = deferred();
  const historyRequests = [];
  const stateRequests = [];
  h.bindings.fetch = async (url, options) => {
    if (String(url).startsWith("/api/agent/")) {
      // 命令带 init，运行态读没有：只统计后者。
      if (options)
        return response({ success: true, data: {}, sessionId: "b", runtimeId: "runtime:r1" });
      stateRequests.push(String(url));
      return { ok: true, json: async () => ({ running: false }) };
    }
    if (String(url).includes("/context?")) {
      navigationRequested.resolve();
      return { ok: true, json: () => navigationBody.promise };
    }
    const body = deferred();
    historyRequests.push(body);
    return { ok: true, json: () => body.promise };
  };

  const navigating = h.bindings.handleNavigate("target-leaf");
  await navigationRequested.promise;
  // /reload 的整段载入连同运行态一起读：让位后补发的那次不能只剩正文。
  const reloading = h.bindings.loadSession("b", false, true);
  historyRequests[0].resolve(sessionSnapshot("persisted-leaf", "persisted"));
  assert.deepEqual(await reloading, { deferred: true });
  assert.deepEqual(stateRequests, []);

  navigationBody.resolve(context("target"));
  await navigating;
  await Promise.all(h.commands);
  assert.equal(historyRequests.length, 2);
  historyRequests[1].resolve(sessionSnapshot("target-leaf", "target"));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(stateRequests, ["/api/agent/runtime%3Ar1"]);
  assert.deepEqual(h.ui.EntryIds, ["target-entry"]);
});

test("a deferred refresh is dropped when the session has moved on by the time the navigation settles", async () => {
  const h = harness();
  const navigationRequested = deferred();
  const navigationBody = deferred();
  const historyRequests = [];
  h.bindings.fetch = async (url) => {
    if (String(url).startsWith("/api/agent/")) {
      return response({ success: true, data: {}, sessionId: "b", runtimeId: "runtime:r1" });
    }
    if (String(url).includes("/context?")) {
      navigationRequested.resolve();
      return { ok: true, json: () => navigationBody.promise };
    }
    const body = deferred();
    historyRequests.push(body);
    return { ok: true, json: () => body.promise };
  };

  const navigating = h.bindings.handleNavigate("target-leaf");
  await navigationRequested.promise;
  const loading = h.bindings.loadSession("b");
  historyRequests[0].resolve(sessionSnapshot("persisted-leaf", "persisted"));
  assert.deepEqual(await loading, { deferred: true });

  // 用户切去了别的会话：这次导航连正文都没应用，更不该替旧会话补发载入。
  h.bindings.sessionIdRef.current = "other";
  navigationBody.resolve(context("target"));
  await navigating;
  await Promise.all(h.commands);

  assert.equal(historyRequests.length, 1);
  assert.deepEqual(h.ui.Messages, [{ role: "user", content: "current messages" }]);
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
  // 这一叶真的载入成功过，是唯一的退回目标。
  h.bindings.appliedLeafIdRef.current = "current-leaf";
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
  h.bindings.fetch = async (url) =>
    String(url).startsWith("/api/agent/")
      ? response({ success: true, data: {}, sessionId: "b", runtimeId: "runtime:r1" })
      : response(context("recovered branch"));
  await h.bindings.handleLeafChange("broken-leaf");
  await Promise.all(h.commands);

  assert.equal(h.ui.ActiveLeafId, "broken-leaf");
  assert.equal(h.bindings.activeLeafIdRef.current, "broken-leaf");
  assert.deepEqual(h.ui.Messages, [{ role: "user", content: "recovered branch" }]);
});

test("a failed entry navigation rolls the leaf back with the marker", async () => {
  const h = harness();
  h.bindings.appliedLeafIdRef.current = "current-leaf";
  h.bindings.activeLeafIdRef.current = "current-leaf";
  h.bindings.fetch = failingContext(503);

  await h.bindings.handleNavigate("broken-leaf");
  await Promise.all(h.commands);

  // 两条导航路径同一规则：先写、失败一起退。界面不会停在一条没载入的分支上。
  assert.equal(h.ui.ActiveLeafId, "current-leaf");
  assert.equal(h.bindings.activeLeafIdRef.current, "current-leaf");
  assert.deepEqual(h.ui.Messages, [{ role: "user", content: "current messages" }]);
});

test("a failed branch click with nothing loaded rolls back to no leaf, not the one in flight", async () => {
  const h = harness();
  // 一条导航还在途：activeLeafIdRef 指向它，但它从没载入成功。
  h.bindings.activeLeafIdRef.current = "pending-leaf";
  assert.equal(h.bindings.appliedLeafIdRef.current, null);
  h.bindings.fetch = failingContext(500);

  await h.bindings.handleLeafChange("broken-leaf");

  // 退回目标只认真的载入成功过的叶子：在途的那条同样没载入成功，退回去会把界面停在
  // 一条从没载入过的分支上，之后去重判据还会永久吞掉对它的重试。
  assert.equal(h.ui.ActiveLeafId, null);
  assert.equal(h.bindings.activeLeafIdRef.current, null);
  assert.deepEqual(h.commands, []);

  // 退回 null 之后同一条分支还能再点一次。
  h.bindings.fetch = async (url) =>
    String(url).startsWith("/api/agent/")
      ? response({ success: true, data: {}, sessionId: "b", runtimeId: "runtime:r1" })
      : response(context("recovered branch"));
  await h.bindings.handleLeafChange("broken-leaf");
  await Promise.all(h.commands);

  assert.equal(h.ui.ActiveLeafId, "broken-leaf");
  assert.deepEqual(h.ui.Messages, [{ role: "user", content: "recovered branch" }]);
});

test("a failed entry navigation with nothing loaded rolls back to no leaf", async () => {
  const h = harness();
  h.bindings.activeLeafIdRef.current = "pending-leaf";
  h.bindings.fetch = failingContext(503);

  await h.bindings.handleNavigate("broken-leaf");

  // 与切叶同一规则：没有载入成功过的叶子就退回 null，运行时也不动。
  assert.equal(h.ui.ActiveLeafId, null);
  assert.equal(h.bindings.activeLeafIdRef.current, null);
  assert.deepEqual(h.commands, []);
});

test("an entry navigation moves the runtime leaf only after the branch is applied", async () => {
  const h = harness();
  const requests = [];
  h.bindings.fetch = async (url, options) => {
    requests.push({ url, command: options ? JSON.parse(options.body) : null });
    if (String(url).startsWith("/api/agent/")) {
      return response({ success: true, data: {}, sessionId: "b", runtimeId: "runtime:r1" });
    }
    return response(context("target branch"));
  };

  await h.bindings.handleNavigate("target-leaf");
  await Promise.all(h.commands);

  // 先载入、应用成功后才发命令：载入失败就不发，运行时不会停在没载入的分支上，
  // 也就不需要「先发后补反向命令」。
  assert.deepEqual(requests, [
    {
      url: "/api/sessions/runtime%3Ar1/context?deferThinking=1&deferMedia=1&leafId=target-leaf",
      command: null,
    },
    { url: "/api/agent/runtime%3Ar1", command: { type: "navigate_tree", targetId: "target-leaf" } },
  ]);
  assert.equal(h.bindings.activeLeafIdRef.current, "target-leaf");
  assert.deepEqual(h.ui.Messages, [{ role: "user", content: "target branch" }]);
});

test("a leaf click invalidated by a runtime rebind rolls the marker back so the retry is not swallowed", async () => {
  const h = harness();
  // 这一叶真的载入成功过，是唯一的退回目标。
  h.bindings.appliedLeafIdRef.current = "current-leaf";
  h.bindings.activeLeafIdRef.current = "current-leaf";
  const requested = deferred();
  const pendingContext = deferred();
  let contextRequests = 0;
  h.bindings.fetch = async (url) => {
    if (String(url).startsWith("/api/agent/")) {
      return response({ success: true, data: {}, sessionId: "b", runtimeId: "runtime:r2" });
    }
    contextRequests += 1;
    if (contextRequests === 1) {
      requested.resolve();
      return { ok: true, json: () => pendingContext.promise };
    }
    return response(context("recovered branch"));
  };

  const clicking = h.bindings.handleLeafChange("broken-leaf");
  await requested.promise;
  // 载入在途期间运行时被重绑：这次载入作废，又没有更晚的载入来纠正叶子。
  h.bindings.runtimeIdRef.current = "runtime:r2";
  pendingContext.resolve(context("obsolete branch"));
  await clicking;

  // 退回载入成功过的叶子，界面不停在没载入成功的那条分支上，也不多发一次载入。
  assert.equal(h.ui.ActiveLeafId, "current-leaf");
  assert.equal(h.bindings.activeLeafIdRef.current, "current-leaf");
  assert.equal(contextRequests, 1);
  assert.deepEqual(h.commands, []);

  // 去重判据不会把重试吞掉：退回之后同一条分支还能再点一次。
  await h.bindings.handleLeafChange("broken-leaf");
  await Promise.all(h.commands);

  assert.equal(h.ui.ActiveLeafId, "broken-leaf");
  assert.deepEqual(h.ui.Messages, [{ role: "user", content: "recovered branch" }]);
});

test("a superseded navigation leaves the leaf to the newer load", async () => {
  const h = harness();
  const requested = deferred();
  const pendingContext = deferred();
  h.bindings.fetch = async (url) => {
    if (String(url).startsWith("/api/agent/")) {
      return response({ success: true, data: {}, sessionId: "b", runtimeId: "runtime:r1" });
    }
    if (String(url).endsWith("leafId=old-leaf")) {
      requested.resolve();
      return { ok: true, json: () => pendingContext.promise };
    }
    return response(context("latest branch"));
  };

  const navigatingOld = h.bindings.handleNavigate("old-leaf");
  await requested.promise;
  await h.bindings.handleNavigate("latest-leaf");
  await Promise.all(h.commands);
  h.effects.length = 0;
  pendingContext.resolve(context("obsolete branch"));
  await navigatingOld;

  // 更晚的载入已经接管界面与运行时：作废的那次既不退回叶子也不发命令。
  assert.equal(h.ui.ActiveLeafId, "latest-leaf");
  assert.equal(h.bindings.activeLeafIdRef.current, "latest-leaf");
  assert.deepEqual(h.ui.Messages, [{ role: "user", content: "latest branch" }]);
  assert.deepEqual(h.effects, []);
  assert.equal(h.commands.length, 1);
});

test("sends the branch command to the session id the load migrated to", async () => {
  const h = harness();
  const requests = [];
  h.bindings.fetch = async (url, options) => {
    requests.push({ url, command: options ? JSON.parse(options.body) : null });
    if (String(url).startsWith("/api/agent/")) return response({ success: true, data: {} });
    return response(context("migrated branch", { sessionId: "c", runtimeId: null }));
  };

  await h.bindings.handleNavigate("target-leaf");
  await Promise.all(h.commands);

  // 载入把会话迁到 c 并让运行时失效：命令要发给当前的会话 id，而不是请求开始时
  // 捕获的那个——发给 b 等于把命令投到另一份会话上。
  assert.equal(h.bindings.sessionIdRef.current, "c");
  assert.equal(h.bindings.runtimeIdRef.current, null);
  assert.deepEqual(requests, [
    {
      url: "/api/sessions/runtime%3Ar1/context?deferThinking=1&deferMedia=1&leafId=target-leaf",
      command: null,
    },
    { url: "/api/agent/c", command: { type: "navigate_tree", targetId: "target-leaf" } },
  ]);
});

test("a failed branch command leaves a notice instead of failing silently", async () => {
  const h = harness();
  h.bindings.fetch = async (url) => {
    if (String(url).startsWith("/api/agent/"))
      return response({ error: "target branch is gone" }, 500);
    return response(context("target branch"));
  };

  await h.bindings.handleLeafChange("target-leaf");
  await Promise.allSettled(h.commands);
  await new Promise((resolve) => setTimeout(resolve, 0));

  // 载入成功、运行时那半失败：界面已经换到新分支，失败必须有回执，不能静默。回执只
  // 说明失败这件事，命令的原始异常留在日志里。
  assert.deepEqual(h.ui.Messages, [{ role: "user", content: "target branch" }]);
  assert.deepEqual(
    h.effects.filter(([kind]) => kind === "notice"),
    [["notice", { type: "error", message: "Failed to switch branch" }]],
  );
});

test("a failed branch command leaves the same leaf retryable", async () => {
  const h = harness();
  let commands = 0;
  h.bindings.fetch = async (url) => {
    if (String(url).startsWith("/api/agent/")) {
      commands += 1;
      // 第一次命令失败，运行时因此还停在旧叶子上。
      return commands === 1
        ? response({ error: "runtime is busy" }, 500)
        : response({ success: true, data: {}, sessionId: "b", runtimeId: "runtime:r1" });
    }
    return response(context("target branch"));
  };

  await h.bindings.handleLeafChange("target-leaf");
  await Promise.allSettled(h.commands);

  // 载入应用了，高亮停在新叶上；命令失败，运行时确认值不能跟着写。
  assert.equal(h.ui.ActiveLeafId, "target-leaf");
  assert.equal(h.bindings.runtimeLeafIdRef.current, null);

  // 再点同一叶：只看高亮会把它当成「已经在这条分支上」而吞掉，重试必须真的重载并
  // 重发命令。
  let contextRequests = 0;
  h.bindings.fetch = async (url) => {
    if (String(url).startsWith("/api/agent/")) {
      return response({ success: true, data: {}, sessionId: "b", runtimeId: "runtime:r1" });
    }
    contextRequests += 1;
    return response(context("target branch"));
  };
  const commandsBefore = h.commands.length;

  await h.bindings.handleLeafChange("target-leaf");
  await Promise.allSettled(h.commands);

  assert.equal(contextRequests, 1, "the retry must reload the branch");
  assert.equal(h.commands.length, commandsBefore + 1, "the retry must send the command again");
  assert.equal(h.bindings.runtimeLeafIdRef.current, "target-leaf");
});

test("a failed branch load reports once and never reloads the branch", async () => {
  const h = harness();
  // 这一叶真的载入成功过，失败时高亮退回它。
  h.bindings.appliedLeafIdRef.current = "current-leaf";
  h.bindings.activeLeafIdRef.current = "current-leaf";
  h.bindings.runtimeLeafIdRef.current = "current-leaf";
  let contextRequests = 0;
  h.bindings.fetch = async (url) => {
    if (String(url).startsWith("/api/agent/")) return response({ success: true, data: {} });
    contextRequests += 1;
    return response(null, 500);
  };

  await h.bindings.handleLeafChange("broken-leaf");

  // 失败只退回标记并留一条回执：不补第二次载入，视图不会被拽回末尾，用户也知道
  // 高亮为什么弹了回去。
  assert.equal(contextRequests, 1);
  assert.equal(h.ui.ActiveLeafId, "current-leaf");
  assert.equal(h.bindings.activeLeafIdRef.current, "current-leaf");
  assert.deepEqual(h.commands, []);
  assert.deepEqual(
    h.effects.filter(([kind]) => kind === "notice"),
    [["notice", { type: "error", message: "Failed to load the selected branch" }]],
  );
});

test("clicking the leaf the runtime already confirmed changes nothing", async () => {
  const h = harness();
  h.bindings.fetch = async (url) =>
    String(url).startsWith("/api/agent/")
      ? response({ success: true, data: {}, sessionId: "b", runtimeId: "runtime:r1" })
      : response(context("target branch"));

  await h.bindings.handleLeafChange("target-leaf");
  assert.equal(h.bindings.runtimeLeafIdRef.current, "target-leaf");
  h.effects.length = 0;
  const commandsBefore = h.commands.length;
  h.bindings.fetch = () => {
    throw new Error("the confirmed leaf must not be reloaded");
  };

  await h.bindings.handleLeafChange("target-leaf");

  // 高亮与运行时都在这一叶上：不重载、不记回底票号、也不再发命令。
  assert.deepEqual(h.effects, []);
  assert.equal(h.commands.length, commandsBefore);
});
