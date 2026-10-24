import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAgentSession, discoverAuthStorage, initTheme, SessionManager } from "@oh-my-pi/pi-coding-agent";
import { createMockModel, registerMockApi } from "@oh-my-pi/pi-ai/providers/mock";

/** 假 provider 在自定义 API 注册表里的来源标签，与模型 id、凭据都无关。 */
const MOCK_SOURCE_ID = "ompdesk-test";
const MOCK_CREDENTIAL = { type: "api_key", key: "mock-test-key" };
const PROMPT_DONE_TIMEOUT_MS = 20_000;

export function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), "ompdesk-mock-e2e-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  const sessionDir = join(root, "sessions");
  for (const dir of [cwd, agentDir, sessionDir]) mkdirSync(dir, { recursive: true });
  return { root, cwd, agentDir, sessionDir };
}

// 注册是一次进程级副作用，由本模块独家持有；用例只决定假模型如何应答。
function createRegisteredMockModel(options) {
  registerMockApi(MOCK_SOURCE_ID);
  return createMockModel(options);
}

export function createMockModelForReply(reply) {
  return createRegisteredMockModel({ responses: [{ content: [reply] }] });
}

export function createMockModelForScript(responses) {
  return createRegisteredMockModel({ responses });
}

export function createMockModelForFailure(message) {
  return createRegisteredMockModel({ handler: () => ({ throw: message }) });
}

// 会话在没有对应 provider 的凭据时拒绝派发一轮对话，即使假 provider 从不读取它。
export async function startMockSession({ sandbox, model }) {
  await initTheme(false);
  const sessionManager = SessionManager.create(sandbox.cwd, sandbox.sessionDir);
  const authStorage = await discoverAuthStorage(sandbox.agentDir);
  await authStorage.credentials.set("mock", MOCK_CREDENTIAL);
  const started = await createAgentSession({
    cwd: sandbox.cwd,
    agentDir: sandbox.agentDir,
    authStorage,
    sessionManager,
    model,
    hasUI: false,
  });
  return { authStorage, sessionManager, started };
}

export async function disposeMockSession({ wrapper, started, sandbox }) {
  wrapper.destroy();
  await started.session.dispose?.();
  try {
    rmSync(sandbox.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    // SDK 在进程存活期间一直持有 agentDir 下的 SQLite 句柄；残留临时目录
    // 不能翻转断言结果。
    console.warn(`[mock-e2e] left behind ${sandbox.root} (${error.code})`);
  }
}

export function textOf(message) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((block) => block && block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

export function collectUntilPromptDone(wrapper) {
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
    }, PROMPT_DONE_TIMEOUT_MS).unref();
  });
  return { events, done: Promise.race([done, timeout]), unsubscribe };
}
