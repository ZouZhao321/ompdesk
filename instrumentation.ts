import type { configureHttpDispatcher as ConfigureHttpDispatcher } from "@/lib/http-dispatcher";
import type { startLogging as StartLogging } from "@/lib/logging-startup";
import { importRuntimeModule } from "@/lib/runtime-import";

type DispatcherModule = { configureHttpDispatcher: typeof ConfigureHttpDispatcher };
type LoggingModule = { startLogging: typeof StartLogging };

/**
 * 本地 TypeScript 源码的 file URL。
 *
 * 逐段编码，但保留 Windows 盘符里的冒号：`#`、`?`、`%` 出现在路径里会被 URL 解析吃掉或
 * 在解码阶段失败，整段交给 `new URL()` 只能兜住空格。路径不存在时调用方自己处理。
 */
function localModuleUrl(relativePath: string): string {
  const encodeSegments = (value: string) => {
    const [head, ...rest] = value.split("/");
    return [head, ...rest.map(encodeURIComponent)].join("/");
  };
  return `file:///${encodeSegments(process.cwd().replace(/\\/g, "/"))}/${encodeSegments(relativePath)}`;
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Server logging is part of the process bootstrap: apply the transport
  // policy and write the `process.start` marker before any request is served.
  // A statically visible specifier would pull `node:async_hooks` / `node:fs`
  // into the Edge and browser instrumentation bundles, which Next also
  // compiles; loading it by URL keeps it out of every graph but nodejs.
  //
  // 这份源码只存在于仓库检出里：npm 包与桌面壳只分发构建产物，没有 `lib/`。因此加载失败
  // 只能降级成“这次没有启动日志”，不能挡住后面的 dispatcher 配置与整个进程。
  try {
    const { startLogging } = await importRuntimeModule<LoggingModule>(localModuleUrl("lib/logging-startup.ts"));
    await startLogging();
  } catch (error) {
    console.error(`[ompdesk] 启动日志未初始化：${error instanceof Error ? error.message : String(error)}`);
  }

  if (typeof process.versions.bun === "string") return;

  // Keep the Node-only undici graph out of Next's browser/edge instrumentation
  // bundles. Node 22 can load this local TypeScript module directly.
  const { configureHttpDispatcher } = await importRuntimeModule<DispatcherModule>(localModuleUrl("lib/http-dispatcher.ts"));
  await configureHttpDispatcher();
}
