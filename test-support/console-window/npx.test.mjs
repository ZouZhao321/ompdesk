/**
 * 无控制台进程里的 npx 调用与更新类命令构建。
 *
 * 上一组用例已经证明判定能看见未隐藏的控制台子进程；这里只跑正向：`npx --version` 真实
 * 调用与更新命令的构建都不得新建可见控制台窗口。安装命令只构建、不执行，也不联网。
 */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { consoleWindowCheck, measureNewConsoleWindows } from "../console-window-guard.mjs";

const NPX_SCENARIO = path.join(import.meta.dir, "npx-scenario.mjs");

test("无控制台进程里的 npx 调用与更新命令构建不新建可见控制台窗口", consoleWindowCheck, async () => {
  const { newWindows, exitCode, timedOut, subjectResult } = await measureNewConsoleWindows({
    mode: "with",
    scenario: NPX_SCENARIO,
    // 假凭据只在被测进程里存在：场景拿它核对 npx 环境是否摘掉凭据、输出是否脱敏。
    env: { OMPDESK_FAKE_API_KEY: "sk-fake-console-window-fixture-0123456789" },
    timeoutMs: 90_000,
  });

  assert.equal(timedOut, false, "被测进程没有在时限内退出");
  assert.equal(exitCode, 0, `npx 调用与更新命令构建未跑通：${subjectResult?.error ?? ""}`);
  assert.equal(subjectResult?.ok, true, `场景没有报告成功：${subjectResult?.error ?? ""}`);
  assert.deepEqual(newWindows, [], `仍然出现可见控制台窗口：${newWindows.map((e) => e.title).join("、")}`);
});
