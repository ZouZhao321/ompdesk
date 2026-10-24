import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createAgentSession, discoverAuthStorage, initTheme, SessionManager } from "@oh-my-pi/pi-coding-agent";
import { createMockModel, registerMockApi } from "@oh-my-pi/pi-ai/providers/mock";

import { MessageView } from "../../components/MessageView.tsx";
import { I18nProvider } from "../../hooks/useI18n";

const MOCK_API_ID = "ompdesk-test";
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

export function createMockModelForReply(reply) {
  registerMockApi(MOCK_API_ID);
  return createMockModel({ responses: [{ content: [reply] }] });
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
  if (!message || !Array.isArray(message.content)) return "";
  return message.content
    .filter((block) => block && block.type === "text")
    .map((block) => block.text)
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

// 服务端渲染会走组件真实的渲染路径（hooks、markdown、语法高亮），不需要 DOM，
// 这样抛错或消息消失会在这里暴露，而不是在浏览器里。
export function renderMessage(message) {
  return renderToStaticMarkup(createElement(I18nProvider, null, createElement(MessageView, { message })));
}

// 语法高亮把 token 包进 <span>，所以针对可见文本的断言先去掉标签。
export function visibleText(html) {
  return html
    .replace(/<[^>]*>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&");
}
