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
const [{ createAgentDirSandbox }, { getDefaultForWeb, getSettingForWeb, getSetting, getDefault, setSetting }, { Settings }] =
 await Promise.all([
  jiti.import("../test-support/agent-dir-sandbox.ts"),
  jiti.import("./omp-settings.ts"),
  jiti.import("@oh-my-pi/pi-coding-agent"),
 ]);

const PATH = "display.collapseCompacted";

test("网页端默认不折叠，用户显式配置后跟随用户的值", async (t) => {
 const sandbox = createAgentDirSandbox(t, { prefix: "ompdesk-web-setting-", dirs: [] });
 const settings = await Settings.init({ agentDir: sandbox.agentDir });

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
 const sandbox = createAgentDirSandbox(t, { prefix: "ompdesk-web-setting-", dirs: [] });
 const settings = await Settings.init({ agentDir: sandbox.agentDir });

 // 真实存在的路径，且默认值非 undefined：否则两个断言会退化成 undefined === undefined。
 const other = "hideThinkingBlock";
 assert.equal(getDefault(other), false);
 assert.equal(getSettingForWeb(settings, other), getSetting(settings, other));
 assert.equal(getDefaultForWeb(other), getDefault(other));
});
