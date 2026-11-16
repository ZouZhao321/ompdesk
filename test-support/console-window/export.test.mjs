/**
 * 无控制台进程里的会话导出。
 *
 * 用户症状：后台实例运行期间导出会话会闪出可见窗口并抢走前台焦点。导出本身要起子进程
 * （omp CLI 的 `--export`），在无控制台进程里就多一个可见窗口。两条用例覆盖路由的真实
 * 成功与失败路径：成功导出本机样本会话，缺失会话如实返回 404。
 *
 * 已知限制：断言只能确认路由跑通且导出体量真实，无法区分「omp CLI 子进程导出」与「进程内
 * 降级导出」——降级路径本来就不弹窗，窗口判定覆盖不到它。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { consoleWindowCheck, measureNewConsoleWindows, WINDOW_TMP_ROOT } from "../console-window-guard.mjs";

const EXPORT_SCENARIO = path.join(import.meta.dir, "export-scenario.mjs");

/** 场景目录建在用例的临时目录下，用例结束整体删除。 */
function makeScenarioRoot(t) {
  const root = path.join(WINDOW_TMP_ROOT, "export", `${process.pid}-${Date.now()}`);
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

async function runScenario(t, caseName, timeoutMs) {
  const root = makeScenarioRoot(t);
  // 路由的导出产物落在系统临时目录：把被测进程的临时目录收进场景目录，产物残留不会
  // 逃出用例的清理范围。
  const tmp = path.join(root, "tmp");
  return measureNewConsoleWindows({
    mode: "with",
    scenario: EXPORT_SCENARIO,
    env: {
      OMPDESK_CONSOLE_SCENARIO_ROOT: root,
      OMPDESK_CONSOLE_EXPORT_CASE: caseName,
      TEMP: tmp,
      TMP: tmp,
      TMPDIR: tmp,
    },
    timeoutMs,
  });
}

test("无控制台进程里的会话导出成功且不新建可见控制台窗口", consoleWindowCheck, async (t) => {
  const { newWindows, exitCode, timedOut, subjectResult } = await runScenario(t, "existing", 90_000);

  assert.equal(timedOut, false, "被测进程没有在时限内退出");
  assert.equal(exitCode, 0, `导出未跑通：${subjectResult?.error ?? ""}`);
  assert.equal(subjectResult?.ok, true, `导出结果未写入成功状态：${subjectResult?.error ?? ""}`);
  assert.deepEqual(newWindows, [], `仍然出现可见控制台窗口：${newWindows.map((entry) => entry.title).join("、")}`);
});

test("无控制台进程里导出缺失会话返回 404 且不新建可见控制台窗口", consoleWindowCheck, async (t) => {
  const { newWindows, exitCode, timedOut, subjectResult } = await runScenario(t, "missing", 60_000);

  assert.equal(timedOut, false, "被测进程没有在时限内退出");
  assert.equal(exitCode, 0, `缺失会话的导出没有按 404 返回：${subjectResult?.error ?? ""}`);
  assert.equal(subjectResult?.ok, true, `导出结果未写入成功状态：${subjectResult?.error ?? ""}`);
  assert.deepEqual(newWindows, [], `仍然出现可见控制台窗口：${newWindows.map((entry) => entry.title).join("、")}`);
});
