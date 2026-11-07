import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAgentSession, discoverAuthStorage, initTheme, SessionManager } from "@oh-my-pi/pi-coding-agent";
import { createMockModel, registerMockApi } from "@oh-my-pi/pi-ai/providers/mock";

/** 假 provider 在自定义 API 注册表里的来源标签，与模型 id、凭据都无关。 */
const MOCK_SOURCE_ID = "ompdesk-test";
const MOCK_CREDENTIAL = { type: "api_key", key: "mock-test-key" };
const PROMPT_DONE_TIMEOUT_MS = 20_000;

export function makeSandbox(t) {
	const root = mkdtempSync(join(tmpdir(), "ompdesk-mock-e2e-"));
	const cwd = join(root, "project");
	const agentDir = join(root, "agent");
	const sessionDir = join(root, "sessions");
	for (const dir of [cwd, agentDir, sessionDir]) mkdirSync(dir, { recursive: true });
	const sandbox = { root, cwd, agentDir, sessionDir };
	// 沙箱一建好就登记清理：startMockSession 抛错时 disposeMockSession 还没登记，
	// 只靠它会把临时目录留在 tmp 下。disposeMockSession 的 force 删除依然幂等。
	t?.after(() => {
		try {
			rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
		} catch {
			// disposeMockSession 会再试一次；这里只兜住初始化失败路径。
		}
	});
	return sandbox;
}

// 注册是一次进程级副作用，由本模块独家持有；用例只决定假模型如何应答。
let mockApiRegistered = false;
function createRegisteredMockModel(options) {
	if (!mockApiRegistered) {
		registerMockApi(MOCK_SOURCE_ID);
		mockApiRegistered = true;
	}
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
	const providerKey = model?.provider;
	if (!providerKey) throw new Error("startMockSession requires a model that declares a provider");
	await authStorage.credentials.set(providerKey, MOCK_CREDENTIAL);
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
	try {
		wrapper.destroy();
		// destroy() 已发起过一次 inner.dispose()，这里 await 只是等它落定。
		await started.session.dispose?.();
	} catch (error) {
		// dispose 失败不能跳过临时目录清理，也不能把 after 钩子失败盖过真正的断言结果。
		console.warn(`[mock-e2e] teardown failed for ${sandbox.root}: ${error?.message ?? error}`);
	}
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
	const unsubscribeEvent = wrapper.onEvent((event) => {
		events.push(event);
		if (event.type === "prompt_done") resolveDone();
	});
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => {
			reject(new Error(`prompt_done never arrived; saw: ${events.map((event) => event.type).join(", ")}`));
		}, PROMPT_DONE_TIMEOUT_MS);
		timer.unref();
	});
	const settled = Promise.race([done, timeout]).finally(() => clearTimeout(timer));
	// 调用方可能先等到 send() 抛错，来不及 await settled；先挂一个处理器，
	// 避免 20 秒后的超时 rejection 变成未处理拒绝。
	settled.catch(() => {});
	const unsubscribe = () => {
		clearTimeout(timer);
		unsubscribeEvent();
	};
	return { events, done: settled, unsubscribe };
}
