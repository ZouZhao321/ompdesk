import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

import { createAgentSession, discoverAuthStorage, initTheme, SessionManager } from "@oh-my-pi/pi-coding-agent";
import { createMockModel, registerMockApi } from "@oh-my-pi/pi-ai/providers/mock";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

const REPLY = "收到，这是假模型的回复";
const TIMEOUT_MS = 20_000;

function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), "ompdesk-mock-e2e-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  const sessionDir = join(root, "sessions");
  for (const dir of [cwd, agentDir, sessionDir]) mkdirSync(dir, { recursive: true });
  return { root, cwd, agentDir, sessionDir };
}

function textOf(message) {
  if (!message || !Array.isArray(message.content)) return "";
  return message.content
    .filter((block) => block && block.type === "text")
    .map((block) => block.text)
    .join("");
}

function collectUntilPromptDone(wrapper) {
  const events = [];
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const unsubscribe = wrapper.onEvent((event) => {
    events.push(event);
    if (event.type === "prompt_done") resolveDone();
  });
  const timeout = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`prompt_done never arrived; saw: ${events.map((event) => event.type).join(", ")}`));
    }, TIMEOUT_MS).unref();
  });
  return { events, done: Promise.race([done, timeout]), unsubscribe };
}

test("a prompt reaches the assistant message and prompt_done through the real session pipeline", async (t) => {
  const sandbox = makeSandbox();
  registerMockApi("ompdesk-test");
  const mock = createMockModel({ responses: [{ content: [REPLY] }] });

  await initTheme(false);
  const sessionManager = SessionManager.create(sandbox.cwd, sandbox.sessionDir);
  // The session refuses to dispatch a turn without a credential for the
  // model's provider, even though the mock provider never reads it.
  const authStorage = await discoverAuthStorage(sandbox.agentDir);
  await authStorage.credentials.set("mock", { type: "api_key", key: "mock-test-key" });
  const started = await createAgentSession({
    cwd: sandbox.cwd,
    agentDir: sandbox.agentDir,
    authStorage,
    sessionManager,
    model: mock,
    hasUI: false,
  });

  const wrapper = new AgentSessionWrapper(started.session, started.eventBus);
  wrapper.start();

  t.after(async () => {
    wrapper.destroy();
    await started.session.dispose?.();
    try {
      rmSync(sandbox.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      // The SDK keeps SQLite handles under agentDir open for the process
      // lifetime; a locked temp directory must not flip an assertion result.
      console.warn(`[mock-e2e] left behind ${sandbox.root} (${error.code})`);
    }
  });

  const collected = collectUntilPromptDone(wrapper);
  try {
    await wrapper.send({ type: "prompt", message: "你好" });
    await collected.done;
  } finally {
    collected.unsubscribe();
  }

  const assistantEnd = collected.events.find(
    (event) => event.type === "message_end" && event.message?.role === "assistant",
  );
  assert.ok(assistantEnd, "no assistant message_end event reached the subscriber");
  assert.equal(textOf(assistantEnd.message), REPLY);
  assert.ok(
    collected.events.some((event) => event.type === "agent_start"),
    "agent_start never reached the subscriber",
  );
  assert.equal(wrapper.isRunning(), false, "wrapper still reports a running prompt after prompt_done");
  assert.equal(mock.calls.length, 1, "the mock provider should serve exactly one call");
});
