/**
 * 折叠开关的读取。
 *
 * 会话转写是否折叠压缩历史是展示项：读设置失败（agent.db 被锁、项目配置损坏）时
 * 必须按不折叠处理，不能因为一个展示开关就让整个会话读取返回 500。
 *
 * 设置来源由参数注入，用例因此不碰真实 `~/.omp/agent/agent.db`，也不依赖开发者本机
 * 是否开过这个开关；沙箱只用来提供一份干净的 Settings。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const [{ shouldCollapseCompactedHistory }, { createAgentDirSandbox }, { setSetting }, sdk] = await Promise.all([
  jiti.import("./transcript-collapse.ts"),
  jiti.import("../test-support/agent-dir-sandbox.ts"),
  jiti.import("./omp-settings.ts"),
  jiti.import("@oh-my-pi/pi-coding-agent"),
]);

const PATH = "display.collapseCompacted";

/**
 * 沙箱里的一份干净 Settings。
 * @param t 测试上下文
 */
async function sandboxSettings(t) {
  const sandbox = createAgentDirSandbox(t, { prefix: "ompdesk-collapse-", dirs: [] });
  return sdk.Settings.loadIsolated({ agentDir: sandbox.agentDir });
}

test("读设置失败时回落为不折叠，不抛出", async () => {
  const failure = new Error("agent.db is locked");
  const result = await shouldCollapseCompactedHistory("/some/cwd", () => Promise.reject(failure));
  assert.equal(result, false);
});

test("显式开启折叠时返回 true", async (t) => {
  const settings = await sandboxSettings(t);
  setSetting(settings, PATH, true);

  assert.equal(await shouldCollapseCompactedHistory("/some/cwd", () => Promise.resolve(settings)), true);
});

test("未配置该开关时返回 false", async (t) => {
  const settings = await sandboxSettings(t);

  assert.equal(await shouldCollapseCompactedHistory("/some/cwd", () => Promise.resolve(settings)), false);
});
