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
  return { on: () => () => {} };
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
    abort: async () => {},
    abortBash: () => {},
    dispose: async () => {},
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
  const calls = { prompt: [], custom: [] };
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
  assert.equal(options, undefined);

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
