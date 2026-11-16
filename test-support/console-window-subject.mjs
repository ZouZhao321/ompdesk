/**
 * 被测进程入口：执行服务启动入口，再跑一个场景模块。
 *
 * 用法：`bun console-window-subject.mjs <with|without> <场景模块路径>`。
 * `with` 走 `instrumentation.register()`，与后台实例的服务进程同一形态；`without` 跳过它，
 * 用作反向对照。场景的成功与失败写进结果文件：被测进程的输出被丢弃，失败原因只能这样带回来。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [, , mode, scenario] = process.argv;
const resultFile = process.env.OMPDESK_CONSOLE_SUBJECT_RESULT;

function report(result) {
  if (!resultFile) return;
  fs.writeFileSync(resultFile, JSON.stringify(result));
}

if (!mode || !scenario) {
  report({ ok: false, error: "用法：console-window-subject.mjs <with|without> <场景模块>" });
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

try {
  if (mode === "with") {
    process.env.NEXT_RUNTIME = "nodejs";
    const instrumentation = await import(pathToFileURL(path.join(root, "instrumentation.ts")).href);
    await instrumentation.register();
  }

  const scenarioUrl = pathToFileURL(path.resolve(scenario)).href;
  const { run } = await import(scenarioUrl);
  await run();
  report({ ok: true });
} catch (error) {
  report({ ok: false, error: error instanceof Error ? (error.stack ?? error.message) : String(error) });
  process.exit(1);
}
