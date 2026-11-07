import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

import { loadEntriesFromFile, migrateToCurrentVersion } from "@oh-my-pi/pi-coding-agent";

import { renderMessage, visibleText } from "../lib/testing/render-harness.mjs";

const jiti = createJiti(import.meta.url);
const { buildSessionContext, invalidateSessionListCache, listAllSessions } =
	await jiti.import("../lib/session-reader.ts");
const { getDisplayableAssistantBlocks } = await jiti.import("../lib/message-display.ts");
const { seedSessions } = await jiti.import("../test-support/session-fixtures.ts");
const { SandboxDirectoryCreateError, createAgentDirSandbox, switchAgentDir } = await jiti.import(
	"../test-support/agent-dir-sandbox.ts",
);

/** 按 mtime 从新到旧扫描时，最多检查多少个候选会话就放弃。 */
const CANDIDATE_LIMIT = 10;
/** 单次用例渲染的消息条数上限。 */
const MESSAGE_LIMIT = 20;

/** 会话库或会话文件不存在：全新 CI runner 的正常状态，不是环境故障，应当改用样本会话。 */
const MISSING_PATH_ERROR_CODES = new Set(["ENOENT", "ENOTDIR"]);

/** 会话库存在却读不出来：权限或占用问题，属于环境限制，跳过用例而不是失败。 */
const UNREADABLE_STORE_ERROR_CODES = new Set(["EACCES", "EPERM", "EBUSY"]);

function errorCode(error) {
	return error && typeof error === "object" ? error.code : undefined;
}

/** 路径不存在（库扫描目录或会话文件没了）不是故障，走样本回退。 */
function isMissingPathError(error) {
	return MISSING_PATH_ERROR_CODES.has(errorCode(error));
}

/** 只有会话库不可读才算可跳过的环境问题；harness 与 SDK 的契约变化必须失败。 */
function isUnreadableStoreError(error) {
	return UNREADABLE_STORE_ERROR_CODES.has(errorCode(error));
}

/**
 * 只有沙箱目录建不出来才算可跳过的环境问题：`mkdtempSync` / `mkdirSync` 的失败被
 * 沙箱包成 `SandboxDirectoryCreateError`。切换与复位活动目录失败抛的是别的类型——
 * 那是 SDK 契约或本模块的回归，必须让用例失败，而不是当成环境限制跳过。
 */
function isSandboxDirectoryCreateError(error) {
	return error instanceof SandboxDirectoryCreateError;
}

/**
 * 每台机器的会话库不同，所以夹具在运行时挑选：取会话列表里 mtime（`modified`）最新
 * 的一条（mtime 相同则按路径升序，保证顺序稳定），再用仓库自己的
 * `buildSessionContext()` 把文件条目转成组件输入。该函数是 UI 唯一的转换入口——内部
 * 调用 `normalizeToolCalls()`，并按 transcript 模式折叠 compaction——因此这里不存在
 * 第二套转换逻辑。
 *
 * 读取走 `loadEntriesFromFile()`：它只解析 JSONL，不创建 writer、不取单写者锁、也
 * 不触发迁移写回（`getSessionEntries()` 背后的 `SessionManager.open()` 会取锁）。
 * 用例因此不会写入或修改任何会话文件，也不会和正在写文件的会话进程抢锁。
 *
 * `fixture` 非空表示找到了可渲染的真实会话。会话库或会话文件不存在（全新 CI runner
 * 就是这种状态）返回 `reason` 让用例改铺样本；只有会话库存在却读不出来才把
 * `environmentError` 设为跳过原因。
 */
async function selectLocalFixture() {
	let sessions;
	try {
		invalidateSessionListCache();
		sessions = await listAllSessions({ force: true });
	} catch (error) {
		if (isMissingPathError(error)) {
			return { fixture: null, reason: "本机没有会话库，改用样本会话", environmentError: null };
		}
		if (!isUnreadableStoreError(error)) throw error;
		const reason = `本机会话库不可读，跳过历史会话夹具：${error.message}`;
		return { fixture: null, reason, environmentError: reason };
	}
	const candidates = sessions
		.filter((session) => typeof session.path === "string" && session.path.length > 0)
		.sort((a, b) => b.modified.localeCompare(a.modified) || a.path.localeCompare(b.path));

	if (candidates.length === 0) {
		return {
			fixture: null,
			reason: "本机没有已记录的会话文件，改用样本会话",
			environmentError: null,
		};
	}

	const inspected = candidates.slice(0, CANDIDATE_LIMIT);
	for (const session of inspected) {
		try {
			const parsed = await loadEntriesFromFile(session.path);
			// 与产品加载路径一致：先迁移到当前版本，再去掉 session header。
			// `loadEntriesFromFile()` 不取单写者锁，因此迁移只发生在内存里。
			migrateToCurrentVersion(parsed);
			const entries = parsed.filter((entry) => entry.type !== "session");
			const { messages } = buildSessionContext(entries, entries.at(-1)?.id ?? null);
			if (messages.length > 0) {
				return {
					fixture: { session, messages: messages.slice(0, MESSAGE_LIMIT) },
					reason: null,
					environmentError: null,
				};
			}
		} catch (error) {
			if (isMissingPathError(error)) {
				// 列出与读取之间文件没了：不是回归，换下一个候选，最终没有可用的就走样本。
				console.log(`[history-fixtures] 会话文件在列出之后消失，跳过 ${session.path}: ${error.message}`);
			} else if (isUnreadableStoreError(error)) {
				console.log(`[history-fixtures] 跳过无法读取的会话 ${session.path}: ${error.message}`);
			} else {
				throw error;
			}
		}
	}

	return {
		fixture: null,
		reason: `最新的 ${inspected.length} 个会话文件都没有可渲染的消息，改用样本会话`,
		environmentError: null,
	};
}

/**
 * 本机没有会话时铺一份确定性样本：临时目录 + 活动目录切换，用例结束自动清理，不碰
 * 真实会话目录。铺好之后仍走 `listAllSessions()` → `buildSessionContext()` 的产品读取
 * 路径，覆盖与真实历史一致。
 *
 * 沙箱目录建不出来才返回 null，由用例按环境问题跳过。
 */
async function seedFixture(t) {
	let sandbox;
	try {
		sandbox = createAgentDirSandbox(t, {
			prefix: "ompdesk-history-fixtures-",
			dirs: ["agent", "project"],
			// 列表缓存跟着活动目录走，恢复原目录前先清掉指向样本的缓存。
			beforeRestore: invalidateSessionListCache,
		});
	} catch (error) {
		// 只容忍沙箱目录建不出来：那是环境限制，不是回归。切换与复位活动目录在沙箱
		// 内部，失败时抛的是别的错误类型（EPERM/EBUSY 也可能出现在那里），会直接让
		// 用例失败，不会被当成 CI 跳过。
		if (!isSandboxDirectoryCreateError(error)) throw error;
		const cause = error.cause instanceof Error ? error.cause.message : String(error.cause ?? "无更多信息");
		console.log(`[history-fixtures] 无法在临时目录铺设会话样本：${error.message}（${cause}）`);
		return null;
	}

	const agentDir = join(sandbox.root, "agent");
	const cwd = join(sandbox.root, "project");
	// tools 场景一轮覆盖正文、思考、工具调用（read 与 bash）与结果回填，样本只有一条
	// 会话，夹具挑选结果不随文件 mtime 变化。
	await seedSessions("tools", { agentDir, cwd });
	// 活动目录切到样本目录，listAllSessions() 才扫描到这里。
	switchAgentDir(agentDir);

	const { fixture, reason } = await selectLocalFixture();
	assert.ok(fixture, `样本会话没有读到可渲染的消息：${reason}`);
	return fixture;
}

/**
 * 独立渲染时本来就为空的消息：`toolResult` 由 MessageView 返回 null，结果正文只通过
 * `toolResults` 映射到对应 toolCall 下方（配对渲染见 MessageView.render.test.mjs），
 * 因此这里不要求它产出可见文本，改为断言它确实不渲染任何标记。
 */
function rendersNothingStandalone(message) {
	if (message.role === "toolResult") return true;
	// 没有可显示块的 assistant 按设计同样返回 null：`getDisplayableAssistantBlocks()`
	// 过滤掉空 thinking 之后为空，例如被中断的轮次。
	if (message.role !== "assistant") return false;
	if (message.stopReason === "error") return false;
	return getDisplayableAssistantBlocks(message).length === 0;
}

const FRAGMENT_PATTERN = /[\p{L}\p{N}_]{2,}/gu;
const IMAGE_FRAGMENT = "\u0000image";

/**
 * 从消息自身取出可用于断言的内容片段：正文、思考、工具名、错误原因、命令输出。
 * 复制按钮、时间戳、模型名这类固定外框文案不属于消息内容，不能用来证明渲染成功。
 */
function contentFragments(message) {
	const fragments = new Set();
	const addText = (value) => {
		if (typeof value !== "string") return;
		for (const match of value.matchAll(FRAGMENT_PATTERN)) fragments.add(match[0]);
	};

	addText(message.content);
	if (Array.isArray(message.content)) {
		for (const block of message.content) {
			if (!block || typeof block !== "object") continue;
			if (block.type === "text") addText(block.text);
			else if (block.type === "thinking") addText(block.thinking);
			else if (block.type === "toolCall") {
				const name = block.toolName ?? block.name;
				if (typeof name !== "string") continue;
				const normalized = name.toLowerCase();
				const input = block.input ?? block.arguments;
				if (
					normalized === "bash" ||
					normalized.startsWith("bash ") ||
					normalized.endsWith(".bash") ||
					normalized.endsWith("_bash")
				) {
					// bash 走 ConsoleOutputPreview，只渲染命令与输出，不渲染工具名。
					addText(input?.command);
				} else if (normalized === "todo" || normalized.endsWith(".todo") || normalized.endsWith("_todo")) {
					// 无结果时走通用头部（显示工具名）；有 phases 时标题为 Todo。
					addText(name);
					addText("Todo");
				} else {
					addText(name);
				}
			} else if (block.type === "image") fragments.add(IMAGE_FRAGMENT);
		}
	}
	addText(message.errorMessage);
	addText(message.command);
	addText(message.output);
	return [...fragments];
}

const localFixture = await selectLocalFixture();
// Bun 的 reporter 只打印 skip 计数，不显示 skip 选项里的原因；这里把它写进输出。
if (localFixture.reason) console.log(`[history-fixtures] ${localFixture.reason}`);

test(
	"历史会话的消息（至多 20 条）都能渲染出消息自身内容",
	{ skip: localFixture.environmentError ?? false },
	async (t) => {
		const fixture = localFixture.fixture ?? (await seedFixture(t));
		if (!fixture) {
			// 沙箱目录建不出来只有跑到这里才知道，没法挪到注册期；Bun 的 node:test 兼容层里
			// `t.skip()` 会抛 NotImplementedError，所以打印原因后直接返回，不写成跳过。
			console.log("[history-fixtures] 临时目录里无法铺设会话样本，跳过历史会话夹具");
			return;
		}
		const { session, messages } = fixture;

		assert.ok(messages.length > 0, `${session.path} 没有可渲染的消息`);

		for (const [index, message] of messages.entries()) {
			const label = `消息 #${index}（role=${message.role}${message.customType ? `, customType=${message.customType}` : ""}）`;

			let html;
			assert.doesNotThrow(() => {
				html = renderMessage(message);
			}, `${label} 渲染时抛错，来源 ${session.path}`);

			if (rendersNothingStandalone(message)) {
				assert.equal(html, "", `${label} 按设计不独立渲染，却产出了标记`);
				continue;
			}

			const text = visibleText(html);
			const fragments = contentFragments(message);
			if (fragments.length === 0) {
				assert.ok(text.trim().length > 0, `${label} 的可见文本为空，来源 ${session.path}`);
				continue;
			}
			const rendered = fragments.some((fragment) =>
				fragment === IMAGE_FRAGMENT ? /<img\b/.test(html) : text.includes(fragment),
			);
			assert.ok(
				rendered,
				`${label} 的可见文本没有包含消息自身内容` +
					`（片段：${fragments.slice(0, 5).join("、")}），来源 ${session.path}`,
			);
		}
	},
);
