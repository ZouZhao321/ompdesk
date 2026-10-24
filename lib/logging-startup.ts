import path from "node:path";
import { pathToFileURL } from "node:url";
import pkg from "../package.json";
import { configureLogging, logEvent } from "./logging";

/**
 * Server bootstrap logging: apply the transport policy once, then write the
 * `process.start` marker that proves which build, runtime, address and auth
 * mode the panel is looking at.
 */

export type StartupMode = "development" | "production" | "desktop";

interface AuthStoreModule {
  getWebAuthStatus(): { enabled: boolean };
}

const importRuntimeModule = Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<AuthStoreModule>;

/**
 * `bin/web-auth-store.js` is plain CommonJS shared with the launcher. A static
 * import would make Next's instrumentation webpack pass bundle it and reject
 * `node:crypto`, so resolve it at runtime like the server already does for
 * `lib/http-dispatcher.ts`.
 */
async function detectAuthEnabled(): Promise<boolean> {
  try {
    // `pathToFileURL` handles drive letters, spaces, `#`, and `?`; a hand-built
    // `file://` URL would misparse every one of them on Windows.
    const moduleUrl = pathToFileURL(path.join(process.cwd(), "bin", "web-auth-store.js"));
    const authStore = await importRuntimeModule(moduleUrl.href);
    return authStore.getWebAuthStatus().enabled;
  } catch (error) {
    // The fallback is only a guess: say so, because a wrong `authEnabled`
    // field would contradict the real access policy in the audit trail.
    logEvent("warn", "process", "process.auth.detect-failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return Boolean(process.env.OMPDESK_PASSWORD);
  }
}

export interface ProcessStartFields extends Record<string, unknown> {
  version: string;
  runtime: string;
  listenAddress: string;
  authEnabled: boolean;
  mode: StartupMode;
  pid: number;
}

function readArg(argv: string[], long: string, short: string): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === long || arg === short) {
      const next = argv[index + 1];
      if (next && !next.startsWith("-")) return next;
      continue;
    }
    if (arg.startsWith(`${long}=`)) return arg.slice(long.length + 1);
    if (arg.startsWith(`${short}=`)) return arg.slice(short.length + 1);
  }
  return undefined;
}

function formatHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

/** The address the panel should show, derived from the same flags the server was started with. */
export function resolveListenAddress(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv,
): string {
  const host = env.OMPDESK_HOSTNAME ?? readArg(argv, "--hostname", "-H") ?? "127.0.0.1";
  const port = env.PORT ?? readArg(argv, "--port", "-p") ?? "30141";
  return `http://${formatHost(host)}:${port}`;
}

export function resolveStartupMode(env: NodeJS.ProcessEnv = process.env): StartupMode {
  if (env.OMPDESK_DESKTOP === "1") return "desktop";
  return env.NODE_ENV === "production" ? "production" : "development";
}

export function describeRuntime(versions: NodeJS.ProcessVersions = process.versions): string {
  return versions.bun ? `bun ${versions.bun}` : `node ${versions.node}`;
}

export function readAppVersion(): string {
  if (process.env.NEXT_PUBLIC_APP_VERSION) return process.env.NEXT_PUBLIC_APP_VERSION;
  return typeof pkg.version === "string" && pkg.version ? pkg.version : "unknown";
}

export interface ProcessStartInput {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  pid?: number;
  version?: string;
  runtime?: string;
  authEnabled?: boolean;
}

/** Build the stable `process.start` payload; separated from emission so tests can pin every field. */
export function buildProcessStartFields(input: ProcessStartInput = {}): ProcessStartFields {
  const env = input.env ?? process.env;
  return {
    version: input.version ?? readAppVersion(),
    runtime: input.runtime ?? describeRuntime(),
    listenAddress: resolveListenAddress(env, input.argv ?? process.argv),
    authEnabled: input.authEnabled ?? false,
    mode: resolveStartupMode(env),
    pid: input.pid ?? process.pid,
  };
}

let started = false;

export interface StartLoggingOptions {
  /** Test seam: redirect the file transport instead of omp's default log directory. */
  file?: boolean | string;
  /** Test seam: force stdout mirroring. */
  stdout?: boolean;
  env?: NodeJS.ProcessEnv;
  /** Test seam: override the detected auth state. */
  authEnabled?: boolean;
  /** Test seam: pin argv/pid/version/runtime. */
  fields?: ProcessStartInput;
}

/** Apply transports and emit the startup marker once per process. Never throws. */
export async function startLogging(options: StartLoggingOptions = {}): Promise<void> {
  if (started && options.file === undefined) return;
  started = true;
  await configureLogging({
    file: options.file,
    stdout: options.stdout,
    env: options.env,
  });
  try {
    const authEnabled = options.authEnabled ?? await detectAuthEnabled();
    logEvent("info", "process", "process.start", buildProcessStartFields({
      ...options.fields,
      env: options.env ?? options.fields?.env,
      authEnabled,
    }));
  } catch {
    // Startup must proceed even when logging is unavailable.
  }
}
