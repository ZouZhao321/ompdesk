import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

import {
  collectUntilPromptDone,
  createMockModelForFailure,
  disposeMockSession,
  makeSandbox,
  startMockSession,
} from "./testing/mock-session-harness.mjs";
import { renderMessage, visibleText } from "./testing/render-harness.mjs";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

// 假模型把这个字符串原样放进终端错误事件，因此它只能来自假模型本身。
const FAILURE_TEXT = "假模型拒绝回答本次请求";

test("a provider failure surfaces its reason, still ends the prompt, and leaves the wrapper idle", { timeout: 30_000 }, async (t) => {
  const sandbox = makeSandbox(t);
  // 每一个模型调用都以同样的方式失败：即使重试重新打开，错误原因也保持一致。
  const mock = createMockModelForFailure(FAILURE_TEXT);
  const { started } = await startMockSession({ sandbox, model: mock });
  // 自动重试会在失败后继续轮询模型，把失败路径的断言拖进退避计时；
  // 关闭它只影响等待时长，不改变 `prompt()` 如何把失败交给 wrapper。
  started.session.setAutoRetryEnabled(false);

  const wrapper = new AgentSessionWrapper(started.session, started.eventBus);
  wrapper.start();

  t.after(() => disposeMockSession({ wrapper, started, sandbox }));

  // 假 provider 在进程内完成整个请求；记录任何真实的 fetch 调用，
  // 使"失败原因来自网络"或"用例偷偷联网"都表现为断言的翻转。
  const realFetch = globalThis.fetch;
  const networkCalls = [];
  globalThis.fetch = (...args) => {
    networkCalls.push(String(args[0]));
    return realFetch(...args);
  };

  const collected = collectUntilPromptDone(wrapper);
  try {
    await wrapper.send({ type: "prompt", message: "你好" });
    await collected.done;
  } finally {
    collected.unsubscribe();
    globalThis.fetch = realFetch;
  }

  // SDK 把 provider 的终端错误落成一条 stopReason 为 "error" 的 assistant 消息，
  // 而不是让 prompt() 抛出，所以错误以 message_end 的形式到达订阅者。
  const failureEvent = collected.events.find(
    (event) => event.type === "message_end" && event.message?.role === "assistant",
  );
  assert.ok(failureEvent, `no assistant message_end reached the subscriber; saw: ${eventTypes(collected.events)}`);
  assert.equal(failureEvent.message.stopReason, "error", "the assistant turn did not report a provider error");
  assert.equal(failureEvent.message.errorMessage, FAILURE_TEXT, "the subscriber did not receive the provider failure reason");

  // 可见性：错误原因必须真的渲染到消息里，而不是只存在于事件中。
  const rendered = visibleText(renderMessage(failureEvent.message));
  assert.ok(
    rendered.includes(FAILURE_TEXT),
    `the rendered error message does not show the failure reason: ${rendered.slice(0, 200)}`,
  );

  // 失败不能把会话卡在运行状态：终止事件到达后 wrapper 必须已经复位。
  assert.ok(
    collected.events.some((event) => event.type === "prompt_done"),
    `prompt_done never reached the subscriber; saw: ${eventTypes(collected.events)}`,
  );
  assert.equal(wrapper.isRunning(), false, "wrapper still reports a running prompt after a provider failure");

  assert.equal(mock.calls.length, 1, "the mock provider should serve exactly one call");
  assert.deepEqual(networkCalls, [], "the failure path must not use the network");
});

function eventTypes(events) {
  return events.map((event) => event.type).join(", ");
}
