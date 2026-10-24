import type { configureHttpDispatcher as ConfigureHttpDispatcher } from "@/lib/http-dispatcher";
import { importRuntimeModule } from "@/lib/runtime-import";

type DispatcherModule = { configureHttpDispatcher: typeof ConfigureHttpDispatcher };

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Server logging is part of the process bootstrap: apply the transport
  // policy and write the `process.start` marker before any request is served.
  // A static import would pull `node:async_hooks` / `node:fs` into the Edge
  // instrumentation bundle, which Next also compiles.
  const { startLogging } = await import("@/lib/logging-startup");
  await startLogging();

  if (typeof process.versions.bun === "string") return;

  // Keep the Node-only undici graph out of Next's browser/edge instrumentation
  // bundles. Node 22 can load this local TypeScript module directly.
  const moduleUrl = `file://${encodeURI(process.cwd())}/lib/http-dispatcher.ts`;
  const { configureHttpDispatcher } = await importRuntimeModule<DispatcherModule>(moduleUrl);
  await configureHttpDispatcher();
}
