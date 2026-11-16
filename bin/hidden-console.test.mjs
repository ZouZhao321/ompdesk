/**
 * 后台实例的服务进程必须带着不可见的控制台启动。
 *
 * 用户症状：更新到 1.1 之后，后台实例运行期间玩全屏游戏会突然退出全屏。服务进程由启动器以
 * detached 拉起、没有控制台；此后它启动的每个控制台程序，Windows 都会新建一个可见的控制台
 * 窗口并抢走前台焦点。ompdesk 自己的子进程调用都带 `windowsHide`，但 agent 执行命令走 SDK
 * 的原生 shell，那条路径不接受这个参数——只能让服务进程自己有一个隐藏控制台，让子进程继承它。
 *
 * 判定用系统口径：轮询枚举可见的 `ConsoleWindowClass` 窗口，只统计被测进程存活期间新出现的。
 * 轮询与被测进程脚手架在 `test-support/console-window-guard.mjs`，这里只挑场景与断言。两条
 * 用例跑同一个场景：带上启动入口必须没有新窗口，去掉启动入口必须出现新窗口；只保留前者时，
 * 判定失灵会让用例静默通过。
 */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { consoleWindowCheck, measureNewConsoleWindows } from "../test-support/console-window-guard.mjs";

const SDK_SHELL_SCENARIO = path.join(import.meta.dir, "..", "test-support", "console-window", "sdk-shell-scenario.mjs");

test("后台实例启动的子进程不再弹出可见控制台窗口", consoleWindowCheck, async () => {
  const { newWindows, exitCode, timedOut, subjectResult } = await measureNewConsoleWindows({
    mode: "with",
    scenario: SDK_SHELL_SCENARIO,
    timeoutMs: 60_000,
  });

  assert.equal(timedOut, false, "被测进程没有在时限内退出");
  assert.equal(exitCode, 0, `SDK shell 没有跑通：${subjectResult?.error ?? ""}`);
  assert.equal(subjectResult?.ok, true, `场景没有报告成功：${subjectResult?.error ?? ""}`);
  assert.deepEqual(
    newWindows,
    [],
    `修复后仍然出现了可见控制台窗口：${newWindows.map((entry) => entry.title).join("、")}`,
  );
});

test("去掉隐藏控制台时该判定会变红", consoleWindowCheck, async () => {
  // 反向用例：同一个场景少掉启动入口，SDK shell 的控制台窗口必须被看见。判定失灵时这条会
  // 失败，前一条的通过因此才有意义。
  const { newWindows, exitCode, timedOut, subjectResult } = await measureNewConsoleWindows({
    mode: "without",
    scenario: SDK_SHELL_SCENARIO,
    timeoutMs: 60_000,
  });

  assert.equal(timedOut, false, "被测进程没有在时限内退出");
  assert.equal(exitCode, 0, `SDK shell 没有跑通：${subjectResult?.error ?? ""}`);
  assert.ok(
    newWindows.length > 0,
    "不补隐藏控制台时应当出现可见控制台窗口；没有出现说明判定失灵，前一条用例的通过不作数",
  );
});
