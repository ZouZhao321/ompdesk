import path from "node:path";
import type { existsSync as ExistsSync } from "node:fs";
import type { pathToFileURL as PathToFileURL } from "node:url";
import type { configureHttpDispatcher as ConfigureHttpDispatcher } from "@/lib/http-dispatcher";
import type { startLogging as StartLogging } from "@/lib/logging-startup";
import { importRuntimeModule } from "@/lib/runtime-import";

type DispatcherModule = { configureHttpDispatcher: typeof ConfigureHttpDispatcher };
type LoggingModule = { startLogging: typeof StartLogging };
type FsModule = { existsSync: typeof ExistsSync };
type HiddenConsoleModule = { ensureHiddenConsole: () => boolean };

/**
 * 本地 TypeScript 源码的 file URL。
 *
 * `pathToFileURL` 负责盘符、空格、`#`、`?`、`%` 的编码，手拼 `file://` 会在这些字符上出错。
 * 它是 `node:` 内置模块，静态导入会被 Next 拖进 Edge 与浏览器的 instrumentation 打包图，
 * 因此按运行时加载。路径不存在时由调用方处理。
 */
async function localModuleUrl(relativePath: string): Promise<string> {
  const { pathToFileURL } = await importRuntimeModule<{ pathToFileURL: typeof PathToFileURL }>("node:url");
  return pathToFileURL(`${process.cwd()}/${relativePath}`).href;
}

/** 入口源码在本进程的文件系统里是否存在；只用于探测，不参与 import。 */
async function localModuleExists(relativePath: string): Promise<boolean> {
  const { existsSync } = await importRuntimeModule<FsModule>("node:fs");
  return existsSync(`${process.cwd()}/${relativePath}`);
}

/** 加载仓库内的本地模块并执行它；入口缺失按预期降级，其余失败保留堆栈。 */
async function runLocalModule<T>(
  relativePath: string,
  label: string,
  run: (loaded: T) => Promise<void> | void,
): Promise<void> {
  // 判定入口文件是否存在，不看错误码：模块自身的依赖缺失同样是 `ERR_MODULE_NOT_FOUND`，
  // 那种情况要留下堆栈，不能被当成“没有这份源码”。探测本身失败也走同一条降级。
  try {
    if (!(await localModuleExists(relativePath))) {
      console.warn(`[ompdesk] ${label}源码不存在，已跳过`);
      return;
    }
    const loaded = await importRuntimeModule<T>(await localModuleUrl(relativePath));
    await run(loaded);
  } catch (error) {
    console.error(`[ompdesk] ${label}执行失败：`, error);
  }
}

/**
 * 给服务进程补一个不可见的控制台。
 *
 * Windows 上，没有控制台的进程再启动控制台程序时，系统会给每个子进程新分配一个**可见**的
 * 控制台窗口并抢走前台焦点，全屏运行的程序会被踢出全屏。后台实例由启动器以 detached 拉起，
 * 服务进程正是这种状态。
 *
 * ompdesk 自己的子进程调用都带 `windowsHide`，但 agent 执行命令走 SDK 的原生 shell，那条
 * 路径不接受这个参数——只能由宿主先给自己一个隐藏控制台，让子进程改为继承它。
 *
 * `bin/hidden-console.js` 是零依赖 CommonJS，两个运行时都能加载，且随包分发；静态导入会把
 * `bun:ffi` 带进 Next 的 instrumentation 打包图，因此按 URL 加载。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // 先于任何请求：服务进程此后启动的每个子进程都受这一条影响。
  // 拿不到隐藏控制台只会让后台实例的子进程弹窗，不该挡住整个进程启动。
  try {
    const hiddenConsole = await importRuntimeModule<HiddenConsoleModule>(
      await localModuleUrl(path.join("bin", "hidden-console.js")),
    );
    hiddenConsole.ensureHiddenConsole();
  } catch (error) {
    console.error("[ompdesk] 隐藏控制台失败：", error);
  }

  // Server logging is part of the process bootstrap: apply the transport
  // policy and write the `process.start` marker before any request is served.
  // A statically visible specifier would pull `node:async_hooks` / `node:fs`
  // into the Edge and browser instrumentation bundles, which Next also
  // compiles; loading it by URL keeps it out of every graph but nodejs.
  //
  // 这两份源码只存在于仓库检出里：npm 包只分发构建产物，没有 `lib/`。
  // 加载失败降级成“本次没有启动日志 / 没有自定义 dispatcher”，不挡住整个进程。
  await runLocalModule<LoggingModule>("lib/logging-startup.ts", "启动日志", (module) => module.startLogging());

  if (typeof process.versions.bun === "string") return;

  // Keep the Node-only undici graph out of Next's browser/edge instrumentation
  // bundles. Node 22 can load this local TypeScript module directly.
  await runLocalModule<DispatcherModule>("lib/http-dispatcher.ts", "HTTP dispatcher", (module) =>
    module.configureHttpDispatcher(),
  );
}
