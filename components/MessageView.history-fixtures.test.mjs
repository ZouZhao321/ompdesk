import assert from "node:assert/strict";
import { isAbsolute, relative, resolve } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

import { loadEntriesFromFile, migrateToCurrentVersion } from "@oh-my-pi/pi-coding-agent";

import { renderMessage, visibleText } from "../lib/testing/render-harness.mjs";

const jiti = createJiti(import.meta.url);
const { buildSessionContext, invalidateSessionListCache, listAllSessions } = await jiti.import("../lib/session-reader.ts");
const { getDisplayableAssistantBlocks } = await jiti.import("../lib/message-display.ts");

/** 按 mtime 从新到旧扫描时，最多检查多少个候选会话就放弃。 */
const CANDIDATE_LIMIT = 10;
/** 单次用例渲染的消息条数上限。 */
const MESSAGE_LIMIT = 20;
/** 指向一个会话目录即可把夹具限制在该目录下，用于演示无会话时的跳过路径。 */
const SESSION_DIR_ENV = "OMPDESK_FIXTURE_SESSION_DIR";

function pathKey(filePath) {
  const resolved = resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isInside(dir, filePath) {
  const rel = relative(pathKey(dir), pathKey(filePath));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
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
 */
async function selectFixture() {
  let sessions;
  try {
    invalidateSessionListCache();
    sessions = await listAllSessions({ force: true });
  } catch (error) {
    return {
      fixture: null,
      reason: `读取本机会话列表失败，跳过历史会话夹具：${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const overrideDir = process.env[SESSION_DIR_ENV]?.trim();
  const candidates = sessions
    .filter((session) => typeof session.path === "string" && session.path.length > 0)
    .filter((session) => !overrideDir || isInside(overrideDir, session.path))
    .sort((a, b) => b.modified.localeCompare(a.modified) || a.path.localeCompare(b.path));

  if (candidates.length === 0) {
    return {
      fixture: null,
      reason: overrideDir
        ? `环境变量 ${SESSION_DIR_ENV}=${overrideDir} 下没有会话文件，跳过历史会话夹具`
        : "本机没有已记录的会话文件，跳过历史会话夹具",
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
        return { fixture: { session, messages: messages.slice(0, MESSAGE_LIMIT) }, reason: null };
      }
    } catch (error) {
      console.log(
        `[history-fixtures] 跳过无法读取的会话 ${session.path}: `
          + `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    fixture: null,
    reason: `最新的 ${inspected.length} 个会话文件都没有可渲染的消息，跳过历史会话夹具`,
  };
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
      else if (block.type === "toolCall") addText(block.toolName ?? block.name);
      else if (block.type === "image") fragments.add(IMAGE_FRAGMENT);
    }
  }
  addText(message.errorMessage);
  addText(message.command);
  addText(message.output);
  return [...fragments];
}

let selection;
try {
  selection = await selectFixture();
} catch (error) {
  selection = {
    fixture: null,
    reason: `选择历史会话夹具失败，跳过：${error instanceof Error ? error.message : String(error)}`,
  };
}
const { fixture, reason } = selection;
// Bun 的 reporter 只打印 skip 计数，不显示 skip 选项里的原因；这里把它写进输出。
if (reason) console.log(`[history-fixtures] ${reason}`);

test("真实历史会话的消息（至多 20 条）都能渲染出消息自身内容", { skip: reason ?? false }, () => {
  assert.ok(fixture, "夹具选择结果与跳过原因不一致");
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
    const rendered = fragments.some((fragment) => (
      fragment === IMAGE_FRAGMENT ? /<img\b/.test(html) : text.includes(fragment)
    ));
    assert.ok(
      rendered,
      `${label} 的可见文本没有包含消息自身内容`
        + `（片段：${fragments.slice(0, 5).join("、")}），来源 ${session.path}`,
    );
  }
});
