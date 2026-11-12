import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionManager, Settings } from "@oh-my-pi/pi-coding-agent";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./rpc-manager.ts");
  } catch {
    return import("./rpc-manager.ts");
  }
}

const { AgentSessionWrapper, hasBusyRpcSessionForCwd, startRpcSession } = await loadSubject();

// 子代理注册表订阅的两个可观测总线频道（见 SDK 的 session-observer-registry）。
const SUBAGENT_LIFECYCLE_CHANNEL = "task:subagent:lifecycle";
const SUBAGENT_PROGRESS_CHANNEL = "task:subagent:progress";

/** 只做订阅与手工派发的替身事件总线，让测试能直接投递子代理帧。 */
function makeEventBus() {
  const handlers = new Map();
  return {
    on(channel, handler) {
      handlers.set(channel, handler);
      return () => handlers.delete(channel);
    },
    emit(channel, payload) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`no handler subscribed to ${channel}`);
      handler(payload);
    },
  };
}

function makeInner(overrides = {}) {
  return Object.assign(
    {
      sessionId: "old-session",
      sessionFile: "/tmp/ompdesk-old-session.jsonl",
      isStreaming: false,
      isCompacting: false,
      isBashRunning: false,
      autoCompactionEnabled: true,
      autoRetryEnabled: true,
      configuredThinkingLevel: () => undefined,
      model: undefined,
      agent: { state: {} },
      extensionRunner: undefined,
      queuedMessageCount: 0,
      getContextUsage: () => undefined,
      getQueuedMessages: () => ({ steering: [], followUp: [] }),
      abort: async () => {},
      abortBash: () => {},
      dispose: async () => {},
      handoff: async () => undefined,
    },
    overrides,
  );
}

function collectEvents(wrapper) {
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  return events;
}

/** 取出尚未关闭的最后一条指定方法的 UI 请求。 */
function lastRequest(events, method) {
  return events.filter((event) => event.method === method).at(-1);
}

/** 等待代理侧异步产出请求（例如读取计划文件之后）。 */
async function waitForRequest(events, method) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const request = lastRequest(events, method);
    if (request) return request;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`no ${method} request was emitted`);
}

async function respond(wrapper, request, patch) {
  await wrapper.send({ type: "extension_ui_response", id: request.id, ...patch });
}

function bindUi(wrapper) {
  let context;
  wrapper.bindToolUiContext((uiContext) => {
    context = uiContext;
  });
  assert.ok(context, "bindToolUiContext must hand over a UI context");
  return context;
}

function makeGoal(overrides = {}) {
  return {
    id: "goal-1",
    objective: "ship the release",
    status: "active",
    tokensUsed: 1200,
    timeUsedSeconds: 90,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 扩展 UI 回调
// ---------------------------------------------------------------------------

test("extension select/input/editor requests reach the browser and resolve with its answer", async () => {
  const wrapper = new AgentSessionWrapper(makeInner(), makeEventBus());
  const events = collectEvents(wrapper);
  const ui = bindUi(wrapper);

  const selected = ui.select("Pick a file", ["a.ts", "b.ts"], { timeout: 5_000 });
  const selectRequest = events.at(-1);
  assert.equal(selectRequest.type, "extension_ui_request");
  assert.equal(selectRequest.method, "select");
  assert.equal(selectRequest.title, "Pick a file");
  assert.deepEqual(selectRequest.options, ["a.ts", "b.ts"]);
  assert.equal(typeof selectRequest.expiresAt, "number");
  assert.equal(wrapper.isAwaitingInput(), true);
  await respond(wrapper, selectRequest, { value: "b.ts" });
  assert.equal(await selected, "b.ts");
  assert.equal(wrapper.isAwaitingInput(), false);

  const input = ui.input("Session name", "enter a name");
  const inputRequest = events.at(-1);
  assert.equal(inputRequest.method, "input");
  assert.equal(inputRequest.title, "Session name");
  assert.equal(inputRequest.placeholder, "enter a name");
  await respond(wrapper, inputRequest, { value: "release" });
  assert.equal(await input, "release");

  const editor = ui.editor("Compose", "draft body");
  const editorRequest = events.at(-1);
  assert.equal(editorRequest.method, "editor");
  assert.equal(editorRequest.prefill, "draft body");
  // 浏览器取消作答时扩展拿到 undefined，而不是空串。
  await respond(wrapper, editorRequest, { cancelled: true });
  assert.equal(await editor, undefined);

  wrapper.destroy();
});

test("extension notify/status/widget/title/editor text are forwarded and reflected in state", async () => {
  const wrapper = new AgentSessionWrapper(makeInner(), makeEventBus());
  const events = collectEvents(wrapper);
  const ui = bindUi(wrapper);

  ui.notify("Heads up", "warning");
  const notice = events.at(-1);
  assert.equal(notice.method, "notify");
  assert.equal(notice.message, "Heads up");
  assert.equal(notice.notifyType, "warning");

  ui.setStatus("build", "running");
  const statusChange = events.at(-1);
  assert.equal(statusChange.method, "setStatus");
  assert.equal(statusChange.statusKey, "build");
  assert.equal(statusChange.statusText, "running");
  let state = await wrapper.send({ type: "get_state" });
  assert.deepEqual(state.extensionStatuses, [{ key: "build", text: "running" }]);

  ui.setStatus("build", undefined);
  state = await wrapper.send({ type: "get_state" });
  assert.deepEqual(state.extensionStatuses, []);

  ui.setWidget("todos", ["one", "two"]);
  assert.equal(events.at(-1).method, "setWidget");
  assert.deepEqual(events.at(-1).widgetLines, ["one", "two"]);
  state = await wrapper.send({ type: "get_state" });
  assert.deepEqual(state.extensionWidgets, [{ key: "todos", lines: ["one", "two"], placement: "aboveEditor" }]);

  // 渲染函数形式的 widget 由终端自己绘制，浏览器通道只接受现成的行。
  const eventsBeforeFunctionWidget = events.length;
  ui.setWidget("todos", () => ["ignored"]);
  assert.equal(events.length, eventsBeforeFunctionWidget);
  state = await wrapper.send({ type: "get_state" });
  assert.deepEqual(state.extensionWidgets, [{ key: "todos", lines: ["one", "two"], placement: "aboveEditor" }]);

  ui.setWidget("todos", ["three"], { placement: "belowEditor" });
  state = await wrapper.send({ type: "get_state" });
  assert.deepEqual(state.extensionWidgets, [{ key: "todos", lines: ["three"], placement: "belowEditor" }]);

  ui.setWidget("todos", undefined);
  state = await wrapper.send({ type: "get_state" });
  assert.deepEqual(state.extensionWidgets, []);

  ui.setTitle("ompdesk");
  assert.equal(events.at(-1).method, "setTitle");
  assert.equal(events.at(-1).title, "ompdesk");

  ui.pasteToEditor("pasted text");
  assert.equal(events.at(-1).method, "set_editor_text");
  assert.equal(events.at(-1).text, "pasted text");

  ui.setEditorText("replaced text");
  assert.equal(events.at(-1).method, "set_editor_text");
  assert.equal(events.at(-1).text, "replaced text");

  // 编辑器本身留在浏览器侧，这里只提供空实现。
  assert.equal(ui.getEditorComponent(), undefined);
  assert.equal(ui.getEditorText(), "");
  wrapper.destroy();
});

test("extension custom UI forwards keystrokes and re-renders the mounted component", async () => {
  const wrapper = new AgentSessionWrapper(makeInner(), makeEventBus());
  const events = collectEvents(wrapper);
  const ui = bindUi(wrapper);

  const received = [];
  let finish;
  const pending = ui.custom((tui, theme, keys, done) => {
    finish = done;
    return {
      render: (width) => [`width=${width}`],
      handleInput: (data) => received.push(data),
    };
  });
  // 工厂在微任务里挂载，挂载后才有第一条带 id 的渲染帧。
  await new Promise((resolve) => setTimeout(resolve, 0));
  const mounted = lastRequest(events, "custom");
  assert.ok(mounted, "the custom UI must announce itself with a render frame");
  assert.deepEqual(mounted.lines, ["width=92"]);
  assert.equal(wrapper.isAwaitingInput(), true);

  const rendersBeforeInput = events.filter((event) => event.method === "custom" && event.id === mounted.id).length;
  await wrapper.send({ type: "extension_ui_input", id: mounted.id, data: "jj" });
  assert.deepEqual(received, ["jj"]);
  const rendersAfterInput = events.filter((event) => event.method === "custom" && event.id === mounted.id).length;
  assert.equal(rendersAfterInput, rendersBeforeInput + 1);

  // 未知 id 的按键既不渲染也不报错。
  const eventsBeforeUnknownInput = events.length;
  await wrapper.send({ type: "extension_ui_input", id: "missing-custom-ui", data: "x" });
  assert.equal(events.length, eventsBeforeUnknownInput);

  finish("accepted");
  assert.equal(await pending, "accepted");
  assert.equal(wrapper.isAwaitingInput(), false);
  wrapper.destroy();
});

test("a throwing custom UI input closes the panel and reports the failure", async () => {
  const wrapper = new AgentSessionWrapper(makeInner(), makeEventBus());
  const events = collectEvents(wrapper);
  const ui = bindUi(wrapper);

  const pending = ui.custom(() => ({
    render: () => ["panel"],
    handleInput: () => {
      throw new Error("bad key binding");
    },
  }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const mounted = lastRequest(events, "custom");

  await wrapper.send({ type: "extension_ui_input", id: mounted.id, data: "q" });
  assert.deepEqual(events.at(-1), {
    type: "extension_error",
    extensionPath: `custom-ui:${mounted.id}`,
    event: "custom_ui_input",
    error: "bad key binding",
  });
  assert.equal(await pending, undefined);
  assert.equal(wrapper.isAwaitingInput(), false);
  wrapper.destroy();
});

// ---------------------------------------------------------------------------
// 工具列表
// ---------------------------------------------------------------------------

test("get_tools describes every SDK tool and marks the active ones", async () => {
  const wrapper = new AgentSessionWrapper(
    makeInner({
      sessionFile: "/tmp/ompdesk-tools.jsonl",
      getAllToolNames: () => ["read", "task", "write"],
      getToolByName: (name) => (name === "read" ? { name, description: "Read a file" } : undefined),
      getActiveToolNames: () => ["read", "task"],
    }),
    makeEventBus(),
  );

  assert.equal(wrapper.sessionFile, "/tmp/ompdesk-tools.jsonl");
  assert.deepEqual(await wrapper.send({ type: "get_tools" }), [
    { name: "read", description: "Read a file", active: true },
    { name: "task", description: "", active: true },
    { name: "write", description: "", active: false },
  ]);

  const state = await wrapper.send({ type: "get_state" });
  assert.equal(state.sessionFile, "/tmp/ompdesk-tools.jsonl");
  wrapper.destroy();
});

test("a session without a session file reports an empty path", () => {
  const wrapper = new AgentSessionWrapper(makeInner({ sessionFile: undefined }), makeEventBus());

  assert.equal(wrapper.sessionFile, "");
  wrapper.destroy();
});

// ---------------------------------------------------------------------------
// 子代理快照
// ---------------------------------------------------------------------------

test("subagent frames are streamed and their snapshots retained for state", async () => {
  const bus = makeEventBus();
  const wrapper = new AgentSessionWrapper(makeInner({ sessionId: "sess-subagents" }), bus);
  const events = collectEvents(wrapper);

  bus.emit(SUBAGENT_LIFECYCLE_CHANNEL, {
    id: "s1",
    index: 0,
    agent: "task",
    agentSource: "bundled",
    description: "explore the repo",
    status: "started",
    sessionFile: "/tmp/subagent-s1.jsonl",
  });
  assert.equal(events.at(-1).type, "subagent_lifecycle");
  assert.equal(events.at(-1).payload.id, "s1");

  bus.emit(SUBAGENT_PROGRESS_CHANNEL, {
    index: 0,
    agent: "task",
    agentSource: "bundled",
    sessionFile: "/tmp/subagent-s1.jsonl",
    task: "map the repo",
    progress: {
      id: "s1",
      index: 0,
      agent: "task",
      status: "running",
      task: "map the repo",
      recentTools: [],
      recentOutput: [],
      toolCount: 2,
      requests: 1,
      tokens: 30,
      cost: 0,
      durationMs: 12,
    },
  });
  assert.equal(events.at(-1).type, "subagent_progress");

  let live = await wrapper.send({ type: "get_subagents" });
  assert.equal(live.subagents.length, 1);
  assert.equal(live.subagents[0].id, "s1");
  assert.equal(live.subagents[0].status, "running");
  assert.equal(live.subagents[0].progress.toolCount, 2);

  // SDK 注册表在终态帧之后会清空活跃表，包装器仍要把完成记录留在状态里。
  bus.emit(SUBAGENT_LIFECYCLE_CHANNEL, {
    id: "s1",
    index: 0,
    agent: "task",
    agentSource: "bundled",
    status: "completed",
  });
  live = await wrapper.send({ type: "get_subagents" });
  assert.equal(live.subagents.length, 1);
  assert.equal(live.subagents[0].status, "completed");
  assert.equal(live.subagents[0].task, "map the repo");
  assert.equal(live.subagents[0].progress.status, "completed");

  const state = await wrapper.send({ type: "get_state" });
  assert.equal(state.subagents[0].status, "completed");
  wrapper.destroy();
});

test("subagent history keeps the newest 128 settled snapshots", async () => {
  const bus = makeEventBus();
  const wrapper = new AgentSessionWrapper(makeInner({ sessionId: "sess-subagent-cap" }), bus);

  for (let index = 0; index < 130; index += 1) {
    const id = `sub-${String(index).padStart(3, "0")}`;
    const frame = { id, index, agent: "task", agentSource: "bundled" };
    bus.emit(SUBAGENT_LIFECYCLE_CHANNEL, { ...frame, status: "started" });
    bus.emit(SUBAGENT_LIFECYCLE_CHANNEL, { ...frame, status: "completed" });
  }

  const { subagents } = await wrapper.send({ type: "get_subagents" });
  assert.equal(subagents.length, 128);
  assert.equal(
    subagents.some((snapshot) => snapshot.id === "sub-000"),
    false,
  );
  assert.equal(
    subagents.some((snapshot) => snapshot.id === "sub-001"),
    false,
  );
  assert.equal(
    subagents.some((snapshot) => snapshot.id === "sub-129"),
    true,
  );
  wrapper.destroy();
});

// ---------------------------------------------------------------------------
// 扩展运行时错误上报与关机请求
// ---------------------------------------------------------------------------

function makeExtensionRunner() {
  return {
    initialized: false,
    emitted: [],
    actions: undefined,
    contextActions: undefined,
    onErrorHandler: undefined,
    initialize(actions, contextActions) {
      this.initialized = true;
      this.actions = actions;
      this.contextActions = contextActions;
    },
    onError(handler) {
      this.onErrorHandler = handler;
    },
    async emit(event) {
      this.emitted.push(event);
    },
  };
}

test("extension send/runtime failures and shutdown requests are reported to the browser", async () => {
  const runner = makeExtensionRunner();
  const wrapper = new AgentSessionWrapper(
    makeInner({
      sessionId: "sess-ext",
      extensionRunner: runner,
      sendCustomMessage: async () => {
        throw new Error("send exploded");
      },
    }),
    makeEventBus(),
  );
  const events = collectEvents(wrapper);

  wrapper.beginExtensionBinding();
  await wrapper.waitUntilReady();
  assert.equal(runner.initialized, true);
  assert.deepEqual(runner.emitted, [{ type: "session_start" }]);

  runner.actions.sendMessage({ customType: "note", content: "hi" }, {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(
    events.find((event) => event.type === "extension_error"),
    { type: "extension_error", extensionPath: "extension_send", event: "send", error: "send exploded" },
  );

  runner.onErrorHandler({ extensionPath: "/ext/tools.js", event: "tool_call", error: "boom" });
  assert.deepEqual(events.at(-1), {
    type: "extension_error",
    extensionPath: "/ext/tools.js",
    event: "tool_call",
    error: "boom",
  });

  runner.contextActions.shutdown();
  const shutdownRequest = events.at(-1);
  assert.equal(shutdownRequest.type, "extension_ui_request");
  assert.equal(shutdownRequest.method, "notify");
  assert.equal(shutdownRequest.notifyType, "warning");
  assert.match(shutdownRequest.message, /shutdown is not supported in ompdesk/);
  wrapper.destroy();
});

test("a session that cannot bind extensions reports the failure to its waiters", async () => {
  const runner = {
    async emit() {},
    onError() {},
    initialize() {
      throw new Error("extension runner unavailable");
    },
  };
  const wrapper = new AgentSessionWrapper(makeInner({ extensionRunner: runner }), makeEventBus());

  wrapper.beginExtensionBinding();
  await assert.rejects(wrapper.waitUntilReady(), /extension runner unavailable/);
  // 失败结果被复用：第二次调用不会重跑初始化。
  wrapper.beginExtensionBinding();
  await assert.rejects(wrapper.waitUntilReady(), /extension runner unavailable/);
  wrapper.destroy();
});

// ---------------------------------------------------------------------------
// 计划提案
// ---------------------------------------------------------------------------

function makePlanHarness(t, options = {}) {
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-plan-"));
  t.after(() => fs.rmSync(artifactsDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(artifactsDir, "local"), { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, "local", "plan.md"), "# Plan\n\nAPPROVE-ME\n");

  const calls = { reference: [], planState: [], modeChanges: [], handlers: [] };
  let proposalHandler;
  let planState = {
    enabled: true,
    planFilePath: options.statePlanPath ?? "local://plan.md",
    workflow: "parallel",
  };
  const inner = makeInner({
    sessionId: "sess-plan",
    getPlanModeState: () => planState,
    setPlanModeState: (next) => {
      planState = next;
      calls.planState.push(next);
    },
    setPlanProposalHandler: (handler) => {
      proposalHandler = handler;
      calls.handlers.push(handler);
    },
    setPlanReferencePath: (reference) => calls.reference.push(reference),
    preparePlanForReview: async (title) => ({
      details: options.details ?? { planFilePath: "local://plan.md", title },
    }),
    subscribe: () => () => {},
    sessionManager: {
      getEntries: () => [],
      getCwd: () => artifactsDir,
      getArtifactsDir: () => artifactsDir,
      getSessionId: () => "sess-plan",
      appendModeChange: (mode, data) => calls.modeChanges.push({ mode, data }),
    },
  });
  const wrapper = new AgentSessionWrapper(inner, makeEventBus());
  const events = collectEvents(wrapper);
  wrapper.start();
  return {
    wrapper,
    calls,
    events,
    proposalHandler: () => proposalHandler,
    setPlanState: (next) => {
      planState = next;
    },
  };
}

test("approving a plan review records the reference and leaves plan mode", async (t) => {
  const harness = makePlanHarness(t);
  const proposal = harness.proposalHandler()("Ship it");

  const request = await waitForRequest(harness.events, "plan_review");
  assert.equal(request.type, "extension_ui_request");
  assert.equal(request.title, "Ship it");
  assert.equal(request.planFilePath, "local://plan.md");
  assert.match(request.planContent, /APPROVE-ME/);

  await respond(harness.wrapper, request, { value: JSON.stringify({ action: "approve" }) });
  const result = await proposal;
  assert.match(result.content[0].text, /Plan approved at local:\/\/plan\.md\. Plan mode exited/);
  assert.deepEqual(result.details, { planFilePath: "local://plan.md", title: "Ship it", planExists: true });
  assert.deepEqual(harness.calls.reference, ["local://plan.md"]);
  assert.equal(harness.calls.handlers.at(-1), null);
  assert.equal(harness.calls.planState.at(-1), undefined);
  assert.deepEqual(harness.calls.modeChanges, [{ mode: "none", data: undefined }]);
  harness.wrapper.destroy();
});

test("refining a plan review rewrites the plan path and echoes the feedback", async (t) => {
  const harness = makePlanHarness(t, {
    statePlanPath: "local://stale.md",
    details: { planFilePath: "local://plan.md", title: "Tighten" },
  });
  const proposal = harness.proposalHandler()("Tighten");

  const request = await waitForRequest(harness.events, "plan_review");
  await respond(harness.wrapper, request, {
    value: JSON.stringify({ action: "refine", feedback: "  add tests  " }),
  });

  const result = await proposal;
  assert.match(result.content[0].text, /Plan refinement requested\./);
  assert.match(result.content[0].text, /User feedback:\nadd tests/);
  assert.match(result.content[0].text, /write Tighten to xd:\/\/propose again/);
  assert.deepEqual(harness.calls.planState, [{ enabled: true, planFilePath: "local://plan.md", workflow: "parallel" }]);
  assert.deepEqual(harness.calls.modeChanges, [{ mode: "plan", data: { planFilePath: "local://plan.md" } }]);
  harness.wrapper.destroy();
});

test("a malformed plan review response keeps planning without feedback", async (t) => {
  const harness = makePlanHarness(t);
  const proposal = harness.proposalHandler()("Retry");

  const request = await waitForRequest(harness.events, "plan_review");
  await respond(harness.wrapper, request, { value: "not json" });

  const result = await proposal;
  assert.match(result.content[0].text, /Plan refinement requested\./);
  assert.equal(result.content[0].text.includes("User feedback"), false);
  // 计划路径没有变化，因此不重写会话模式。
  assert.deepEqual(harness.calls.planState, []);
  assert.deepEqual(harness.calls.modeChanges, []);
  harness.wrapper.destroy();
});

test("a plan proposal is rejected when plan mode or the plan file is gone", async (t) => {
  const disabled = makePlanHarness(t);
  const disabledHandler = disabled.proposalHandler();
  disabled.setPlanState(undefined);
  await assert.rejects(disabledHandler("Gone"), /Plan mode is not active\./);

  const unresolved = makePlanHarness(t, { details: {} });
  await assert.rejects(unresolved.proposalHandler()("Missing details"), /The proposed plan could not be resolved\./);

  const missingFile = makePlanHarness(t, {
    details: { planFilePath: "local://missing.md", title: "Ghost" },
  });
  await assert.rejects(missingFile.proposalHandler()("Ghost"), /Plan file not found at local:\/\/missing\.md/);

  disabled.wrapper.destroy();
  unresolved.wrapper.destroy();
  missingFile.wrapper.destroy();
});

// ---------------------------------------------------------------------------
// 目标续跑
// ---------------------------------------------------------------------------

test("an agent_end schedules a hidden goal continuation turn", async () => {
  const settings = Settings.isolated({
    "goal.enabled": true,
    "goal.continuationModes": ["interactive"],
  });
  const calls = [];
  let sessionListener;
  let resolveContinuation;
  const continuationStarted = new Promise((resolve) => {
    resolveContinuation = resolve;
  });
  let goalState = { enabled: true, mode: "active", goal: makeGoal() };
  const inner = makeInner({
    sessionId: "sess-goal",
    settings,
    sessionManager: { getEntries: () => [], getCwd: () => "/tmp" },
    getPlanModeState: () => undefined,
    getGoalModeState: () => goalState,
    setGoalModeState: (next) => {
      goalState = next;
    },
    getEnabledToolNames: () => ["read"],
    setActiveToolsByName: async () => {},
    goalRuntime: { buildContinuationPrompt: () => "KEEP-WORKING" },
    promptCustomMessage: async (message, options) => {
      calls.push({ message, options });
      resolveContinuation();
      return true;
    },
    subscribe: (listener) => {
      sessionListener = listener;
      return () => {};
    },
  });
  const wrapper = new AgentSessionWrapper(inner, makeEventBus());
  const events = collectEvents(wrapper);
  const turnDone = new Promise((resolve) => {
    wrapper.onEvent((event) => {
      if (event.type === "prompt_done") resolve(event);
    });
  });
  wrapper.start();

  sessionListener({ type: "agent_end" });
  await continuationStarted;
  await turnDone;

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].message, {
    customType: "goal-continuation",
    content: "KEEP-WORKING",
    display: false,
    attribution: "user",
  });
  assert.equal(
    events.some((event) => event.type === "prompt_error"),
    false,
  );
  assert.equal(wrapper.isRunning(), false);
  wrapper.destroy();
});

test("a failed goal continuation reports the error and still ends the turn", async () => {
  const wrapper = new AgentSessionWrapper(
    makeInner({
      sessionId: "sess-goal-error",
      promptCustomMessage: async () => {
        throw new Error("continuation model failed");
      },
    }),
    makeEventBus(),
  );
  const events = collectEvents(wrapper);

  // GoalModeController 会吞掉续跑失败（agent_end 之后重新调度），
  // 这里直接驱动包装器自己的记录入口来断言它对浏览器暴露的事件。
  await assert.rejects(wrapper.runGoalContinuation("KEEP-WORKING"), /continuation model failed/);

  assert.deepEqual(
    events.find((event) => event.type === "prompt_error"),
    { type: "prompt_error", errorMessage: "continuation model failed" },
  );
  assert.equal(events.at(-1).type, "prompt_done");
  assert.equal(wrapper.isRunning(), false);
  wrapper.destroy();
});

// ---------------------------------------------------------------------------
// cwd 忙碌判定
// ---------------------------------------------------------------------------

test("a running session makes only its own project cwd busy", (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-busy-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));

  const inner = makeInner({
    sessionId: "sess-busy",
    isStreaming: true,
    sessionManager: { getEntries: () => [], getCwd: () => cwd },
  });
  const wrapper = new AgentSessionWrapper(inner, makeEventBus());
  const previousRegistry = globalThis.__ompSessions;
  globalThis.__ompSessions = new Map([[inner.sessionId, wrapper]]);
  t.after(() => {
    if (previousRegistry) globalThis.__ompSessions = previousRegistry;
    else delete globalThis.__ompSessions;
  });

  assert.equal(hasBusyRpcSessionForCwd(cwd), true);
  assert.equal(hasBusyRpcSessionForCwd(path.join(cwd, "nested")), false);
  assert.equal(hasBusyRpcSessionForCwd(process.cwd()), false);

  wrapper.destroy();
  assert.equal(hasBusyRpcSessionForCwd(cwd), false);
});

test("a session counts its cwd as busy while startup is still in flight", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-starting-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, "project");
  const agentDir = path.join(root, "agent");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });

  // 通过 omp-runtime 自己的缓存入口注入一个离线运行时：模型目录为空，
  // 所以会话构造会在 SDK 内部停止，不会读凭据也不会发网络请求。
  const settings = Settings.isolated({ enabledModels: [] });
  const previousSettingsPromise = globalThis.__ompSettingsPromise;
  const previousRuntimePromise = globalThis.__ompRuntimePromise;
  let releaseRuntime;
  globalThis.__ompSettingsPromise = Promise.resolve(settings);
  globalThis.__ompRuntimePromise = new Promise((resolve) => {
    releaseRuntime = resolve;
  });
  t.after(() => {
    globalThis.__ompSettingsPromise = previousSettingsPromise;
    globalThis.__ompRuntimePromise = previousRuntimePromise;
  });

  const pending = startRpcSession("starting-session", "", cwd, { toolNames: [] }).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );

  // SessionManager.create 是同步的：启动计数在等待运行时之前就已登记。
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(hasBusyRpcSessionForCwd(cwd), true);

  releaseRuntime({
    agentDir,
    settings,
    authStorage: {},
    modelRegistry: { find: () => undefined, getAll: () => [], getAvailable: () => [], refresh: async () => {} },
  });
  const settled = await pending;
  t.after(() => settled.value?.session.destroy());

  assert.ok(settled.error, "the offline runtime stub must not be able to create a session");
  assert.equal(hasBusyRpcSessionForCwd(cwd), false);
});

// ---------------------------------------------------------------------------
// 技能回退
// ---------------------------------------------------------------------------

/** 等到本轮 prompt 收尾，避免断言早于事件。 */
function waitForTurn(wrapper) {
  return new Promise((resolve) => {
    const unsubscribe = wrapper.onEvent((event) => {
      if (event.type !== "prompt_done" && event.type !== "prompt_error") return;
      unsubscribe();
      resolve(event);
    });
  });
}

test("a skill draft sent while skill commands are off announces the fallback", async () => {
  const prompts = [];
  const custom = [];
  const inner = makeInner({
    sessionId: "sess-skill-disabled",
    skills: [{ name: "demo", filePath: "/tmp/does-not-matter/SKILL.md", baseDir: "/tmp/does-not-matter" }],
    skillsSettings: { enableSkillCommands: false },
    sessionManager: { getEntries: () => [] },
    prompt: async (text) => {
      prompts.push(text);
      return true;
    },
    promptCustomMessage: async (message) => {
      custom.push(message);
      return true;
    },
  });
  const wrapper = new AgentSessionWrapper(inner, makeEventBus());
  const events = collectEvents(wrapper);

  const done = waitForTurn(wrapper);
  await wrapper.send({ type: "prompt", message: "/skill:demo focus on auth" });
  await done;

  assert.deepEqual(
    events.find((event) => event.type === "skill_command_unavailable"),
    { type: "skill_command_unavailable", reason: "disabled", skill: "demo" },
  );
  assert.deepEqual(prompts, ["/skill:demo focus on auth"]);
  assert.deepEqual(custom, []);
  wrapper.destroy();
});

test("a skill message the session refuses announces the drop and resends the text", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-skill-fallback-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "SKILL.md");
  fs.writeFileSync(
    filePath,
    ["---", "name: demo", "description: Demo skill", "---", "", "Do the thing.", ""].join("\n"),
  );

  const prompts = [];
  const inner = makeInner({
    sessionId: "sess-skill-dropped",
    skills: [{ name: "demo", filePath, baseDir: dir }],
    skillsSettings: { enableSkillCommands: true },
    sessionManager: { getEntries: () => [] },
    prompt: async (text) => {
      prompts.push(text);
      return true;
    },
    promptCustomMessage: async () => false,
  });
  const wrapper = new AgentSessionWrapper(inner, makeEventBus());
  const events = collectEvents(wrapper);

  const done = waitForTurn(wrapper);
  await wrapper.send({ type: "prompt", message: "/skill:demo focus on auth" });
  await done;

  assert.deepEqual(
    events.find((event) => event.type === "skill_command_unavailable"),
    { type: "skill_command_unavailable", reason: "dropped", skill: "demo" },
  );
  assert.deepEqual(prompts, ["/skill:demo focus on auth"]);
  wrapper.destroy();
});

// ---------------------------------------------------------------------------
// fork 提交后的关机
// ---------------------------------------------------------------------------

async function makeForkHarness(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-fork-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cwd = path.join(dir, "project");
  const sessionDir = path.join(dir, "sessions");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });

  const base = SessionManager.create(cwd, sessionDir);
  base.appendMessage({
    role: "user",
    content: [{ type: "text", text: "first question" }],
    timestamp: Date.now(),
  });
  base.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "first answer" }],
    timestamp: Date.now(),
  });
  await base.ensureOnDisk();
  const baseFile = base.getSessionFile();
  assert.ok(baseFile, "the harness session must exist on disk");

  const disposed = [];
  const inner = makeInner({
    sessionId: "sess-fork",
    sessionFile: baseFile,
    extensionRunner: options.shutdownFails
      ? {
          async emit() {
            throw new Error("shutdown hook failed");
          },
        }
      : undefined,
    sessionManager: {
      getEntries: () => base.getEntries(),
      getCwd: () => cwd,
      getBranch: () => base.getBranch(),
      getEntry: (id) => base.getEntry(id),
      getSessionDir: () => base.getSessionDir(),
    },
    dispose: async () => {
      disposed.push(true);
    },
  });
  const wrapper = new AgentSessionWrapper(inner, makeEventBus());
  return { wrapper, disposed, sessionDir, baseFile };
}

test("fork copies the branch, commits it, and shuts the old wrapper down", async (t) => {
  const harness = await makeForkHarness(t);

  const result = await harness.wrapper.send({ type: "fork", includeEntry: true });

  assert.equal(result.cancelled, false);
  assert.equal(typeof result.newSessionId, "string");
  assert.equal(harness.wrapper.isAlive(), false);
  assert.deepEqual(harness.disposed, [true]);

  const forkedFiles = fs
    .readdirSync(harness.sessionDir)
    .filter((name) => name.endsWith(".jsonl") && path.join(harness.sessionDir, name) !== harness.baseFile);
  assert.equal(forkedFiles.length, 1);
  const forkedEntries = fs
    .readFileSync(path.join(harness.sessionDir, forkedFiles[0]), "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  const header = forkedEntries.find((entry) => entry.type === "session");
  assert.ok(header, `expected a session header, got ${JSON.stringify(forkedEntries)}`);
  assert.equal(header.id, result.newSessionId);
  assert.equal(header.parentSession, harness.baseFile);
});

test("a forked session is still handed back when the old wrapper fails to shut down", async (t) => {
  const harness = await makeForkHarness(t, { shutdownFails: true });
  const errors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  t.after(() => {
    console.error = originalConsoleError;
  });

  const result = await harness.wrapper.send({ type: "fork", includeEntry: true });

  assert.equal(result.cancelled, false);
  assert.equal(typeof result.newSessionId, "string");
  assert.equal(harness.wrapper.isAlive(), false);
  assert.ok(
    errors.some((line) => line.includes(`fork created session ${result.newSessionId}`)),
    `expected the shutdown failure to be logged, got ${JSON.stringify(errors)}`,
  );
});
