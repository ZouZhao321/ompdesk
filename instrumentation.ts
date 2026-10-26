import type { pathToFileURL as PathToFileURL } from "node:url";
import type { configureHttpDispatcher as ConfigureHttpDispatcher } from "@/lib/http-dispatcher";
import type { startLogging as StartLogging } from "@/lib/logging-startup";
import { importRuntimeModule } from "@/lib/runtime-import";

type DispatcherModule = { configureHttpDispatcher: typeof ConfigureHttpDispatcher };
type LoggingModule = { startLogging: typeof StartLogging };

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

/** 加载仓库内的本地模块并执行它；源码缺失按预期降级，其它错误保留堆栈。 */
async function runLocalModule<T>(relativePath: string, label: string, run: (loaded: T) => Promise<void> | void): Promise<void> {
  try {
    const loaded = await importRuntimeModule<T>(await localModuleUrl(relativePath));
    await run(loaded);
  } catch (error) {
    // 源码缺失是可预期的情况（npm 包与桌面壳只分发构建产物）；其它错误说明模块本身有问题。
    if ((error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") {
      console.warn(`[ompdesk] ${label}源码不存在，已跳过`);
      return;
    }
    console.error(`[ompdesk] ${label}执行失败：`, error);
  }
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Server logging is part of the process bootstrap: apply the transport
  // policy and write the `process.start` marker before any request is served.
  // A statically visible specifier would pull `node:async_hooks` / `node:fs`
  // into the Edge and browser instrumentation bundles, which Next also
  // compiles; loading it by URL keeps it out of every graph but nodejs.
  //
  // 这两份源码只存在于仓库检出里：npm 包与桌面壳只分发构建产物，没有 `lib/`。
  // 加载失败降级成“本次没有启动日志 / 没有自定义 dispatcher”，不挡住整个进程。
  await runLocalModule<LoggingModule>("lib/logging-startup.ts", "启动日志", (module) => module.startLogging());

  if (typeof process.versions.bun === "string") return;

  // Keep the Node-only undici graph out of Next's browser/edge instrumentation
  // bundles. Node 22 can load this local TypeScript module directly.
  await runLocalModule<DispatcherModule>("lib/http-dispatcher.ts", "HTTP dispatcher", (module) => module.configureHttpDispatcher());
}
