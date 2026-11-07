import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./rpc-manager.ts");
  } catch {
    return import("./rpc-manager.ts");
  }
}

const { AgentSessionWrapper } = await loadSubject();

function makeEventBus() {
  return { on: () => () => { } };
}

function makeInner(overrides = {}) {
  return Object.assign({
    sessionId: "skill-session",
    sessionFile: "/tmp/ompdesk-skill-session.jsonl",
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
    abort: async () => { },
    abortBash: () => { },
    dispose: async () => { },
    handoff: async () => undefined,
    sessionManager: { getEntries: () => [] },
    getPlanModeState: () => undefined,
  }, overrides);
}

function writeSkill(t, { name = "demo", hide = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-skill-command-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "SKILL.md");
  fs.writeFileSync(filePath, [
    "---",
    `name: ${name}`,
    "description: Test skill",
    "---",
    "",
    "# Demo skill",
    "",
    "Run the BODY-MARKER steps.",
    "Touch @scripts/foo.js and never expand /skill:other.",
    "",
  ].join("\n"));
  return { name, filePath, baseDir: dir, description: "Test skill", hide };
}

function waitForTurn(wrapper) {
  return new Promise((resolve) => {
    const unsubscribe = wrapper.onEvent((event) => {
      if (event.type !== "prompt_done" && event.type !== "prompt_error") return;
      unsubscribe();
      resolve(event);
    });
  });
}

function recordingInner(skill, overrides = {}) {
  const calls = { prompt: [], custom: [], steer: [], followUp: [] };
  const inner = makeInner({
    skills: [skill],
    skillsSettings: { enableSkillCommands: true },
    prompt: async (text) => {
      calls.prompt.push(text);
      return true;
    },
    promptCustomMessage: async (message, options) => {
      calls.custom.push({ message, options });
      return true;
    },
    steer: async (text) => {
      calls.steer.push(text);
    },
    followUp: async (text) => {
      calls.followUp.push(text);
    },
    ...overrides,
  });
  return { inner, calls };
}

test("a typed /skill command delivers the skill envelope as a user custom message", async (t) => {
  const skill = writeSkill(t);
  const { inner, calls } = recordingInner(skill);
  const wrapper = new AgentSessionWrapper(inner, makeEventBus());

  const done = waitForTurn(wrapper);
  await wrapper.send({ type: "prompt", message: "/skill:demo focus on auth" });
  await done;

  assert.deepEqual(calls.prompt, [], "a skill command must not be sent as plain text");
  assert.equal(calls.custom.length, 1);
  const [{ message, options }] = calls.custom;
  assert.equal(message.customType, "skill-prompt");
  assert.equal(message.display, true);
  assert.equal(message.attribution, "user");
  assert.match(message.content, /User invoked the "demo" skill/);
  assert.match(message.content, /BODY-MARKER/);
  assert.match(message.content, /@scripts\/foo\.js/);
  assert.match(message.content, /\/skill:other/);
  assert.match(message.content, /focus on auth/);
  assert.deepEqual(message.details, {
    name: "demo",
    path: skill.filePath,
    args: "focus on auth",
    prompt: "/skill:demo focus on auth",
    lineCount: 4,
  });
  assert.deepEqual(options, { queueChipText: "/skill:demo focus on auth" });

  const state = await wrapper.send({ type: "get_state" });
  assert.equal(state.isPromptRunning, false);
  wrapper.destroy();
});

test("a hidden skill can still be invoked by name", async (t) => {
  const skill = writeSkill(t, { name: "hidden-one", hide: true });
  const { inner, calls } = recordingInner(skill);
  const wrapper = new AgentSessionWrapper(inner, makeEventBus());

  const done = waitForTurn(wrapper);
  await wrapper.send({ type: "prompt", message: "/skill:hidden-one" });
  await done;

  assert.deepEqual(calls.prompt, []);
  assert.equal(calls.custom.length, 1);
  assert.equal(calls.custom[0].message.details.name, "hidden-one");
  assert.equal(calls.custom[0].message.details.args, undefined);
  wrapper.destroy();
});

test("an unknown skill name falls back to a plain prompt", async (t) => {
  const skill = writeSkill(t);
  const { inner, calls } = recordingInner(skill);
  const wrapper = new AgentSessionWrapper(inner, makeEventBus());

  const done = waitForTurn(wrapper);
  await wrapper.send({ type: "prompt", message: "/skill:missing hello" });
  await done;

  assert.deepEqual(calls.prompt, ["/skill:missing hello"]);
  assert.deepEqual(calls.custom, []);
  wrapper.destroy();
});

test("a dropped skill submission reports that it was not delivered", async (t) => {
  const skill = writeSkill(t);
  const { inner, calls } = recordingInner(skill, {
    promptCustomMessage: async () => false,
  });
  const wrapper = new AgentSessionWrapper(inner, makeEventBus());
  const { events } = recordEvents(wrapper);

  const done = waitForTurn(wrapper);
  await wrapper.send({ type: "prompt", message: "/skill:demo hello" });
  await done;

  assert.deepEqual(calls.prompt, [], "a refused skill submission must not fall back silently as a prompt");
  assert.equal(events.find((event) => event.type === "skill_command_unavailable")?.reason, "dropped");
  wrapper.destroy();
});

test("a skill prompt does not hold the request open for the whole turn", async (t) => {
  const skill = writeSkill(t);
  let release = () => {};
  const turn = new Promise((resolve) => {
    release = () => resolve(true);
  });
  const { inner } = recordingInner(skill, {
    promptCustomMessage: () => turn,
  });
  const wrapper = new AgentSessionWrapper(inner, makeEventBus());

  const started = performance.now();
  await wrapper.send({ type: "prompt", message: "/skill:demo slow turn" });
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 500, `send() returned after ${elapsed.toFixed(0)}ms; it must not await the turn`);

  release();
  wrapper.destroy();
});

test("an unset skill-command setting falls back like the SDK does", async (t) => {
  const skill = writeSkill(t);
  const { inner, calls } = recordingInner(skill, { skillsSettings: undefined });
  const wrapper = new AgentSessionWrapper(inner, makeEventBus());
  const { events } = recordEvents(wrapper);

  const done = waitForTurn(wrapper);
  await wrapper.send({ type: "prompt", message: "/skill:demo hello" });
  await done;

  assert.deepEqual(calls.prompt, ["/skill:demo hello"]);
  assert.deepEqual(calls.custom, []);
  assert.equal(events.find((event) => event.type === "skill_command_unavailable")?.reason, "disabled");
  wrapper.destroy();
});

test("disabling skill commands falls back to a plain prompt", async (t) => {
  const skill = writeSkill(t);
  const { inner, calls } = recordingInner(skill, {
    skillsSettings: { enableSkillCommands: false },
  });
  const wrapper = new AgentSessionWrapper(inner, makeEventBus());

  const done = waitForTurn(wrapper);
  await wrapper.send({ type: "prompt", message: "/skill:demo hello" });
  await done;

  assert.deepEqual(calls.prompt, ["/skill:demo hello"]);
  assert.deepEqual(calls.custom, []);
  wrapper.destroy();
});

test("a skill command sent as steer delivers the envelope with steering semantics", async (t) => {
  const skill = writeSkill(t);
  const { inner, calls } = recordingInner(skill);
  const wrapper = new AgentSessionWrapper(inner, makeEventBus());

  await wrapper.send({ type: "steer", message: "/skill:demo tighten the test" });

  assert.deepEqual(calls.steer, [], "a skill steer must not be forwarded as plain text");
  assert.equal(calls.custom.length, 1);
  const [{ message, options }] = calls.custom;
  assert.equal(message.customType, "skill-prompt");
  assert.match(message.content, /BODY-MARKER/);
  assert.equal(options.streamingBehavior, "steer");
  assert.equal(options.queueChipText, "/skill:demo tighten the test");
  wrapper.destroy();
});

test("a skill command sent as follow-up delivers the envelope with follow-up semantics", async (t) => {
  const skill = writeSkill(t);
  const { inner, calls } = recordingInner(skill);
  const wrapper = new AgentSessionWrapper(inner, makeEventBus());

  await wrapper.send({ type: "follow_up", message: "/skill:demo then commit" });

  assert.deepEqual(calls.followUp, [], "a skill follow-up must not be forwarded as plain text");
  assert.equal(calls.custom.length, 1);
  const [{ message, options }] = calls.custom;
  assert.equal(message.customType, "skill-prompt");
  assert.equal(options.streamingBehavior, "followUp");
  assert.equal(options.queueChipText, "/skill:demo then commit");
  wrapper.destroy();
});

test("an unknown skill sent as steer stays a plain steer", async (t) => {
  const skill = writeSkill(t);
  const { inner, calls } = recordingInner(skill);
  const wrapper = new AgentSessionWrapper(inner, makeEventBus());

  await wrapper.send({ type: "steer", message: "/skill:missing keep going" });

  assert.deepEqual(calls.steer, ["/skill:missing keep going"]);
  assert.deepEqual(calls.custom, []);
  wrapper.destroy();
});

function recordEvents(wrapper) {
  const events = [];
  const unsubscribe = wrapper.onEvent((event) => events.push(event));
  return { events, unsubscribe };
}

test("an unknown skill command reports why it was sent as text", async (t) => {
  const skill = writeSkill(t);
  const { inner, calls } = recordingInner(skill);
  const wrapper = new AgentSessionWrapper(inner, makeEventBus());
  const { events } = recordEvents(wrapper);

  const done = waitForTurn(wrapper);
  await wrapper.send({ type: "prompt", message: "/skill:missing hello" });
  await done;

  assert.deepEqual(calls.prompt, ["/skill:missing hello"]);
  const notice = events.find((event) => event.type === "skill_command_unavailable");
  assert.deepEqual(notice, { type: "skill_command_unavailable", reason: "unknown", skill: "missing" });
  wrapper.destroy();
});

test("disabling skill commands reports the setting as the reason", async (t) => {
  const skill = writeSkill(t);
  const { inner, calls } = recordingInner(skill, {
    skillsSettings: { enableSkillCommands: false },
  });
  const wrapper = new AgentSessionWrapper(inner, makeEventBus());
  const { events } = recordEvents(wrapper);

  const done = waitForTurn(wrapper);
  await wrapper.send({ type: "prompt", message: "/skill:demo hello" });
  await done;

  assert.deepEqual(calls.prompt, ["/skill:demo hello"]);
  const notice = events.find((event) => event.type === "skill_command_unavailable");
  assert.deepEqual(notice, { type: "skill_command_unavailable", reason: "disabled", skill: "demo" });
  wrapper.destroy();
});

test("an unreadable skill file falls back to text and says so", async (t) => {
  const skill = writeSkill(t);
  const broken = { ...skill, filePath: `${skill.filePath}.missing` };
  const { inner, calls } = recordingInner(broken);
  const wrapper = new AgentSessionWrapper(inner, makeEventBus());
  const { events } = recordEvents(wrapper);

  const done = waitForTurn(wrapper);
  await wrapper.send({ type: "prompt", message: "/skill:demo hello" });
  await done;

  assert.deepEqual(calls.prompt, ["/skill:demo hello"]);
  assert.deepEqual(calls.custom, []);
  const notice = events.find((event) => event.type === "skill_command_unavailable");
  assert.deepEqual(notice, { type: "skill_command_unavailable", reason: "unreadable", skill: "demo" });
  wrapper.destroy();
});

test("a steered unknown skill reports a fallback notice", async (t) => {
  const skill = writeSkill(t);
  const { inner, calls } = recordingInner(skill);
  const wrapper = new AgentSessionWrapper(inner, makeEventBus());
  const { events } = recordEvents(wrapper);

  await wrapper.send({ type: "steer", message: "/skill:missing keep going" });

  assert.deepEqual(calls.steer, ["/skill:missing keep going"]);
  const notice = events.find((event) => event.type === "skill_command_unavailable");
  assert.equal(notice?.reason, "unknown");
  wrapper.destroy();
});
