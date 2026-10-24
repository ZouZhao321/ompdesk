import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The single write path for ompdesk server logs.
 *
 * Records land in omp's own process log through the SDK logger, so file naming,
 * rotation, batching, `OMP_LOG_LEVEL`, and the existing OTLP sink keep working
 * unchanged. Everything ompdesk adds is provenance (`source`, `subsystem`) and
 * field hygiene: sensitive keys are dropped, strings and stacks are bounded,
 * and no logging failure ever reaches the caller.
 */

/** Severity names accepted by omp's process logger. */
export type LogLevel = "error" | "warn" | "info" | "debug";

interface SdkLogger {
  error(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  setTransports(options: { console?: boolean; file?: boolean | string }): void;
  flush(): void;
}

/**
 * Next bundles instrumentation separately from route handlers, and its webpack
 * pass tries to parse the SDK's TypeScript sources there even though routes
 * externalize `@oh-my-pi/*`. Hiding the specifier behind `Function` keeps the
 * SDK external at runtime; the literal path would be statically bundled and
 * fail on the first `export type` in `logger.ts`.
 */
const importRuntimeModule = Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<SdkLogger>;

let sdkLogger: SdkLogger | undefined;
let sdkLoad: Promise<SdkLogger | undefined> | undefined;

async function loadSdkLogger(): Promise<SdkLogger | undefined> {
  try {
    return await importRuntimeModule("@oh-my-pi/pi-utils/logger");
  } catch {
    // Without the SDK there is nowhere to write; logEvent becomes a no-op
    // rather than preventing the server from starting.
    return undefined;
  }
}

async function ensureSdkLogger(): Promise<SdkLogger | undefined> {
  if (sdkLogger) return sdkLogger;
  sdkLoad ??= loadSdkLogger();
  sdkLogger = await sdkLoad;
  return sdkLogger;
}

/** Marks every record written through this module. */
export const LOG_SOURCE = "ompdesk";

export type LogSubsystem =
  | "process"
  | "http"
  | "agent"
  | "audit"
  | "security"
  | "client"
  | "system";

/** Correlation fields a request wrapper can attach to every nested log call. */
export interface LogContext {
  requestId?: string;
  sessionId?: string;
  runId?: string;
  route?: string;
  method?: string;
  actor?: "local" | "password" | "recovery";
}

const requestContext = new AsyncLocalStorage<LogContext>();

export function getLogContext(): LogContext | undefined {
  return requestContext.getStore();
}

/**
 * Run `callback` with correlation fields attached to every log written inside
 * it. Nested calls merge with the outer context instead of replacing it.
 */
export function runWithLogContext<T>(context: LogContext, callback: () => T): T {
  return requestContext.run({ ...requestContext.getStore(), ...context }, callback);
}

export interface ConfigureLoggingOptions {
  env?: NodeJS.ProcessEnv;
  /** Force stdout mirroring; defaults to `OMPDESK_LOG_STDOUT` or the dev-mode rule. */
  stdout?: boolean;
  /** File transport override. Tests pass a temp directory; production always uses the SDK default. */
  file?: boolean | string;
}

/**
 * Mirror records to stdout when `OMPDESK_LOG_STDOUT` asks for it, otherwise in
 * development only. Production and the desktop shell keep the file transport
 * quiet so the shell's own log capture does not receive a second copy.
 */
export function shouldMirrorStdout(env: NodeJS.ProcessEnv = process.env): boolean {
  const requested = env.OMPDESK_LOG_STDOUT?.trim().toLowerCase();
  if (requested) {
    if (["1", "true", "yes", "on"].includes(requested)) return true;
    if (["0", "false", "no", "off"].includes(requested)) return false;
  }
  return env.NODE_ENV !== "production";
}

let configured = false;

/** Apply the transport policy once at server startup; an explicit override may reconfigure. */
export async function configureLogging(options: ConfigureLoggingOptions = {}): Promise<void> {
  const explicit = options.file !== undefined || options.stdout !== undefined;
  if (configured && !explicit) return;
  try {
    const env = options.env ?? process.env;
    const sdk = await ensureSdkLogger();
    sdk?.setTransports({
      file: options.file ?? true,
      console: options.stdout ?? shouldMirrorStdout(env),
    });
    configured = true;
  } catch {
    // Bootstrapping diagnostics must never stop the server from starting.
  }
}

/** Flush buffered records. Used by tests and by the startup marker before returning. */
export function flushLogs(): void {
  try {
    sdkLogger?.flush();
  } catch {
    // Flushing is best effort, exactly like the SDK's own flush.
  }
}

const MAX_STRING_LENGTH = 2_000;
const MAX_STACK_LENGTH = 4_000;
const MAX_DEPTH = 4;
const MAX_KEYS = 40;
const MAX_ARRAY_ITEMS = 50;

/**
 * Key fragments that always mean a credential, a session secret, or recovery
 * material. Matching works on camelCase and separator-delimited segments so
 * `apiKey`, `api_key`, and `x-api-key` are all redacted.
 *
 * `token` is handled separately: usage counters (`inputTokens`, `tokenCount`,
 * `tokensBefore`) must survive, while credential-shaped token names do not.
 */
const SENSITIVE_SEGMENTS: Record<string, true> = {
  password: true,
  passwd: true,
  passphrase: true,
  secret: true,
  authorization: true,
  cookie: true,
  cookies: true,
  credential: true,
  credentials: true,
  apikey: true,
  recoverycode: true,
  privatekey: true,
  accesskey: true,
  secretkey: true,
  sessionkey: true,
  setcookie: true,
};

const SENSITIVE_PAIRS: Record<string, true> = {
  apikey: true,
  recoverycode: true,
  privatekey: true,
  accesskey: true,
  secretkey: true,
  sessionkey: true,
  setcookie: true,
};

/** Exact credential token names, and the qualified forms that carry one. */
const CREDENTIAL_TOKEN_KEYS: Record<string, true> = {
  token: true,
  tokens: true,
  accesstoken: true,
  refreshtoken: true,
  bearertoken: true,
  authtoken: true,
  sessiontoken: true,
  apitoken: true,
};

function keySegments(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.toLowerCase())
    .filter(Boolean);
}

/** True when a field name denotes material that must never be written. */
export function isSensitiveLogKey(key: string): boolean {
  const segments = keySegments(key);
  if (segments.some((segment) => SENSITIVE_SEGMENTS[segment])) return true;

  const joined = segments.join("");
  if (CREDENTIAL_TOKEN_KEYS[joined]) return true;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const pair = `${segments[index]}${segments[index + 1]}`;
    if (SENSITIVE_PAIRS[pair] || CREDENTIAL_TOKEN_KEYS[pair]) return true;
  }
  return false;
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}… [truncated ${value.length - limit} chars]`;
}

function describeError(value: Error): Record<string, unknown> {
  return {
    name: value.name || "Error",
    message: truncate(value.message, MAX_STRING_LENGTH),
    stack: value.stack ? truncate(value.stack, MAX_STACK_LENGTH) : undefined,
  };
}

function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;

  switch (typeof value) {
    case "string":
      return truncate(value, MAX_STRING_LENGTH);
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "boolean":
      return value;
    case "bigint":
      return `${value}n`;
    case "function":
      return "[function]";
    case "symbol":
      return value.toString();
  }

  if (value instanceof Error) return describeError(value);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[buffer ${value.length} bytes]`;
  if (value instanceof Uint8Array) return `[bytes ${value.byteLength}]`;

  const object = value as object;
  if (seen.has(object)) return "[circular]";
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? "[array]" : "[object]";
  seen.add(object);

  try {
    if (Array.isArray(value)) {
      const items = value
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) => sanitizeValue(item, depth + 1, seen));
      if (value.length > MAX_ARRAY_ITEMS) items.push(`[+${value.length - MAX_ARRAY_ITEMS} more]`);
      return items;
    }

    if (value instanceof Set) {
      return sanitizeValue([...value], depth, seen);
    }
    if (value instanceof Map) {
      return sanitizeValue(Object.fromEntries(value), depth, seen);
    }

    const result: Record<string, unknown> = {};
    const keys = Object.keys(object);
    let copied = 0;
    for (const key of keys) {
      if (isSensitiveLogKey(key)) continue;
      if (copied >= MAX_KEYS) {
        result._truncated = `${keys.length - copied} more keys`;
        break;
      }
      result[key] = sanitizeValue((object as Record<string, unknown>)[key], depth + 1, seen);
      copied += 1;
    }
    return result;
  } finally {
    seen.delete(object);
  }
}

/** Copy a context record, dropping secrets and applying the size limits. */
export function sanitizeLogContext(context: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!context) return {};
  const sanitized = sanitizeValue(context, 0, new WeakSet());
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : {};
}

function write(level: LogLevel, message: string, context: Record<string, unknown>): void {
  if (!sdkLogger) return;
  switch (level) {
    case "error":
      sdkLogger.error(message, context);
      break;
    case "warn":
      sdkLogger.warn(message, context);
      break;
    case "info":
      sdkLogger.info(message, context);
      break;
    case "debug":
      sdkLogger.debug(message, context);
      break;
  }
}

/**
 * Write one structured ompdesk record.
 *
 * `message` is the stable event name (`process.start`, `http.request`, …);
 * business fields stay flat in the record next to `source` and `subsystem`.
 * Never throws: a broken log file must not fail the work it was describing.
 */
export function logEvent(
  level: LogLevel,
  subsystem: LogSubsystem,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  try {
    const context = sanitizeLogContext({
      ...fields,
      ...getLogContext(),
      source: LOG_SOURCE,
      subsystem,
    });
    write(level, message, context);
  } catch {
    // Logging is a side channel; callers never pay for its failures.
  }
}
