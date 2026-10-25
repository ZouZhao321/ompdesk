import type { configureHttpDispatcher as ConfigureHttpDispatcher } from "@/lib/http-dispatcher";
import type { startLogging as StartLogging } from "@/lib/logging-startup";
import { importRuntimeModule } from "@/lib/runtime-import";

type DispatcherModule = { configureHttpDispatcher: typeof ConfigureHttpDispatcher };
type LoggingModule = { startLogging: typeof StartLogging };

/** 本地 TypeScript 源码的 file URL；正斜杠让 Windows 盘符留在路径里而不是主机名。 */
function localModuleUrl(relativePath: string): string {
  return new URL(`file:///${process.cwd().replace(/\\/g, "/")}/${relativePath}`).href;
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Server logging is part of the process bootstrap: apply the transport
  // policy and write the `process.start` marker before any request is served.
  // A statically visible specifier would pull `node:async_hooks` / `node:fs`
  // into the Edge and browser instrumentation bundles, which Next also
  // compiles; loading it by URL keeps it out of every graph but nodejs.
  const { startLogging } = await importRuntimeModule<LoggingModule>(localModuleUrl("lib/logging-startup.ts"));
  await startLogging();

  if (typeof process.versions.bun === "string") return;

  // Keep the Node-only undici graph out of Next's browser/edge instrumentation
  // bundles. Node 22 can load this local TypeScript module directly.
  const { configureHttpDispatcher } = await importRuntimeModule<DispatcherModule>(localModuleUrl("lib/http-dispatcher.ts"));
  await configureHttpDispatcher();
}
