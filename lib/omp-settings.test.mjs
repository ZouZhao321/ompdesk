/**
 * 网页端设置的生效值。
 *
 * `display.collapseCompacted` 在 omp 里默认折叠，网页端未配置时按不折叠读：折叠会把
 * 压缩前的提问移出转写区，提问跳转条的圆点与会话地图的落点就没有目标。用户显式
 * 配置过这一项时，网页端跟随用户的值。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const [{ createAgentDirSandbox }, { getDefaultForWeb, getSettingForWeb, getSetting, getDefault, setSetting }, sdk] =
  await Promise.all([
    jiti.import("../test-support/agent-dir-sandbox.ts"),
    jiti.import("./omp-settings.ts"),
    jiti.import("@oh-my-pi/pi-coding-agent"),
  ]);

const PATH = "display.collapseCompacted";

/**
 * 沙箱里的一份干净 Settings；用隔离实例，避免把全局单例指向测试目录。
 * @param t 测试上下文
 */
async function sandboxSettings(t) {
  const sandbox = createAgentDirSandbox(t, { prefix: "ompdesk-web-setting-", dirs: [] });
  return sdk.Settings.loadIsolated({ agentDir: sandbox.agentDir });
}

test("网页端默认不折叠，用户显式配置后跟随用户的值", async (t) => {
  const settings = await sandboxSettings(t);

  assert.equal(getDefault(PATH), true, "omp 的默认是折叠");
  assert.equal(getSetting(settings, PATH), true, "SDK 生效值跟随 omp 默认");
  assert.equal(getSettingForWeb(settings, PATH), false);
  assert.equal(getDefaultForWeb(PATH), false);

  setSetting(settings, PATH, true);
  assert.equal(getSettingForWeb(settings, PATH), true);

  setSetting(settings, PATH, false);
  assert.equal(getSettingForWeb(settings, PATH), false);
});

test("没有网页端专有默认的设置项照旧读 omp 的值", async (t) => {
  const settings = await sandboxSettings(t);

  // 真实存在、且默认值非 undefined 的路径：否则两个断言会退化成 undefined === undefined。
  // 只断言非空，不锁 omp 对该项的具体默认值。
  const other = "hideThinkingBlock";
  assert.equal(typeof getDefault(other), "boolean");
  assert.equal(getSettingForWeb(settings, other), getSetting(settings, other));
  assert.equal(getDefaultForWeb(other), getDefault(other));
});
