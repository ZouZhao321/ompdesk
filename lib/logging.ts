import { AsyncLocalStorage } from "node:async_hooks";
import { startMemoryMonitor } from "./memory-monitor";
import { importRuntimeModule } from "./runtime-import";

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

/** Structured event handed to sinks after the local transports ran. */
interface SdkLogEvent {
	readonly level: LogLevel;
	readonly message: string;
	readonly context: Record<string, unknown> | undefined;
	readonly timestamp: Date;
}

interface SdkLogger {
	error(message: string, context?: Record<string, unknown>): void;
	warn(message: string, context?: Record<string, unknown>): void;
	info(message: string, context?: Record<string, unknown>): void;
	debug(message: string, context?: Record<string, unknown>): void;
	setTransports(options: { console?: boolean; file?: boolean | string }): void;
	registerLogSink(sink: (event: SdkLogEvent) => void): () => void;
	flush(): void;
}

let sdkLogger: SdkLogger | undefined;
let sdkLoad: Promise<SdkLogger | undefined> | undefined;

async function loadSdkLogger(): Promise<SdkLogger | undefined> {
	try {
		return await importRuntimeModule<SdkLogger>("@oh-my-pi/pi-utils/logger");
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

export type LogSubsystem = "process" | "http" | "agent" | "audit" | "security" | "client" | "system";

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
 * development only. The mirror is an ompdesk log sink rather than the SDK
 * console transport, so `OMP_LOG_LEVEL` filters it exactly like the file.
 * Production keeps it quiet so the file transport is the only sink by default.
 */
export function shouldMirrorStdout(env: NodeJS.ProcessEnv = process.env): boolean {
	const requested = env.OMPDESK_LOG_STDOUT?.trim().toLowerCase();
	if (requested) {
		if (["1", "true", "yes", "on"].includes(requested)) return true;
		if (["0", "false", "no", "off"].includes(requested)) return false;
	}
	return env.NODE_ENV !== "production";
}

/**
 * Transport configuration belongs to the process, but Next compiles
 * instrumentation and route handlers into separate module instances. The flags
 * live on `globalThis` so a route bundle cannot overwrite a policy this
 * process already applied — an explicit `configureLogging` call always wins,
 * and the default policy and the stdout sink are installed at most once.
 */
const TRANSPORTS_CONFIGURED = Symbol.for("ompdesk.logging.transports");
const STDOUT_MIRROR = Symbol.for("ompdesk.logging.stdout-mirror");
const STDOUT_SINK = Symbol.for("ompdesk.logging.stdout-sink");
const transportState = globalThis as unknown as Record<symbol, unknown>;

const LOG_LEVEL_RANK: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

/** `OMP_LOG_LEVEL` (error|warn|info|debug, case-insensitive), default `debug` — same policy as the file. */
function resolveStdoutLevelRank(env: NodeJS.ProcessEnv = process.env): number {
	const requested = env.OMP_LOG_LEVEL?.trim().toLowerCase();
	return requested && Object.hasOwn(LOG_LEVEL_RANK, requested)
		? LOG_LEVEL_RANK[requested as LogLevel]
		: LOG_LEVEL_RANK.debug;
}

function padTimestampPart(value: number, width = 2): string {
	return String(value).padStart(width, "0");
}

/** The SDK's file-record timestamp, so both streams render the same instant the same way. */
function formatLocalTimestamp(date: Date): string {
	const offsetMinutes = -date.getTimezoneOffset();
	const absoluteOffset = Math.abs(offsetMinutes);
	const offsetSign = offsetMinutes >= 0 ? "+" : "-";
	return (
		`${padTimestampPart(date.getFullYear(), 4)}-${padTimestampPart(date.getMonth() + 1)}-${padTimestampPart(date.getDate())}` +
		`T${padTimestampPart(date.getHours())}:${padTimestampPart(date.getMinutes())}:${padTimestampPart(date.getSeconds())}` +
		`.${padTimestampPart(date.getMilliseconds(), 3)}${offsetSign}${padTimestampPart(Math.floor(absoluteOffset / 60))}` +
		`:${padTimestampPart(absoluteOffset % 60)}`
	);
}

/**
 * Mirrors the SDK file transport's rule verbatim: a message that looks like a
 * printf template is paired with positional arguments, not named fields, so its
 * context is dropped. ompdesk's own records use stable event names and never
 * hit this branch; SDK-originated records (`util.format` templates) do, and
 * applying the same rule keeps the stdout mirror field-for-field identical to
 * the file record instead of showing fields the file lacks.
 */
const FORMAT_TOKEN_PATTERN = /%[scdjifoO%]/;

/** Error fields are non-enumerable; unwrap them the way the SDK's file transport does. */
function jsonReplacer(_key: string, value: unknown): unknown {
	if (value instanceof Error) {
		return { name: value.name, message: value.message, stack: value.stack };
	}
	return value;
}

/** Serialize one mirror line with the file record's shape: timestamp, level, pid, message, then context. */
function formatStdoutRecord(event: SdkLogEvent): string {
	const context = event.context && typeof event.context === "object" ? event.context : undefined;
	// See FORMAT_TOKEN_PATTERN: a template message's context is printf arguments,
	// so copying it as named fields would diverge from the file record.
	const metadata = !FORMAT_TOKEN_PATTERN.test(event.message) ? context : undefined;
	const entry: Record<string, unknown> = {
		timestamp: formatLocalTimestamp(event.timestamp),
		level: event.level,
		pid: process.pid,
		message: metadata?.message ? `${event.message} ${metadata.message}` : event.message,
	};
	if (metadata) {
		for (const key of Object.keys(metadata)) {
			if (key !== "level" && key !== "timestamp" && key !== "message") entry[key] = metadata[key];
		}
		if (metadata.stack) entry.stack = metadata.stack;
		if (metadata.cause) entry.cause = metadata.cause;
	}
	return JSON.stringify(entry, jsonReplacer);
}

const STDOUT_EOL = process.platform === "win32" ? "\r\n" : "\n";

interface SyncFileWriter {
	writeSync(fd: number, data: string): number;
}

/**
 * Resolve `node:fs` at call time. A static import would be traced into the
 * edge/browser compilation of instrumentation and fail on the `node:` scheme;
 * the sink only runs in the Node server, where `getBuiltinModule` exists.
 */
function resolveStdoutWriter(): SyncFileWriter | undefined {
	const getBuiltin = (process as NodeJS.Process & { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
	if (typeof getBuiltin !== "function") return undefined;
	const fsModule = getBuiltin("node:fs") as Partial<SyncFileWriter> | undefined;
	return fsModule && typeof fsModule.writeSync === "function" ? (fsModule as SyncFileWriter) : undefined;
}

const stdoutWriter = resolveStdoutWriter();

/** Mirror every SDK event the level policy admits, synchronously and without ever throwing. */
function writeStdoutRecord(event: SdkLogEvent): void {
	try {
		const override = transportState[STDOUT_MIRROR];
		const mirror = typeof override === "boolean" ? override : shouldMirrorStdout();
		if (!mirror) return;
		if (LOG_LEVEL_RANK[event.level] > resolveStdoutLevelRank()) return;
		// The sink also receives records the SDK writes itself, which never passed
		// through `logEvent`; sanitize again so credentials cannot reach stdout.
		const sanitized: SdkLogEvent = {
			...event,
			context: event.context ? sanitizeLogContext(event.context) : undefined,
		};
		const line = `${formatStdoutRecord(sanitized)}${STDOUT_EOL}`;
		if (stdoutWriter) stdoutWriter.writeSync(1, line);
		else process.stdout.write(line);
	} catch {
		// The mirror is a side channel; a broken stdout must never fail a request.
	}
}

/**
 * Register the single process-wide stdout sink. The SDK logger module is shared
 * by every Next bundle instance, so the registration flag must be shared too.
 */
function registerStdoutSink(sdk: SdkLogger): void {
	if (transportState[STDOUT_SINK] === true) return;
	transportState[STDOUT_SINK] = true;
	try {
		sdk.registerLogSink(writeStdoutRecord);
	} catch {
		transportState[STDOUT_SINK] = false;
	}
}

/** Apply the transport policy once at server startup; an explicit override may reconfigure. */
export async function configureLogging(options: ConfigureLoggingOptions = {}): Promise<void> {
	const explicit = options.file !== undefined || options.stdout !== undefined;
	if (!explicit && transportState[TRANSPORTS_CONFIGURED] === true) return;
	try {
		const env = options.env ?? process.env;
		transportState[STDOUT_MIRROR] = options.stdout ?? shouldMirrorStdout(env);
		const sdk = await ensureSdkLogger();
		if (!sdk) return;
		// The SDK console transport ignores `OMP_LOG_LEVEL`; mirror through a sink instead.
		sdk.setTransports({ file: options.file ?? true, console: false });
		registerStdoutSink(sdk);
		transportState[TRANSPORTS_CONFIGURED] = true;
		if (!explicit) startMemorySampling(env);
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
	passwords: true,
	passwd: true,
	passphrase: true,
	secret: true,
	secrets: true,
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

/**
 * A trailing `token` segment marks a credential (`GITHUB_TOKEN`, `idToken`,
 * `oauthToken`). Plural `tokens` names in this codebase report usage
 * (`totalTokens`, `inputTokens`), so only the bare form is a credential; that
 * keeps counters while still rejecting every provider-qualified token name.
 */
const SENSITIVE_PAIRS: Record<string, true> = {
	apikey: true,
	recoverycode: true,
	privatekey: true,
	accesskey: true,
	secretkey: true,
	sessionkey: true,
	setcookie: true,
};

function keySegments(key: string): string[] {
	return key
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.split(/[^A-Za-z0-9]+/)
		.map((part) => part.toLowerCase())
		.filter(Boolean);
}

/**
 * True when a field name denotes material that must never be written.
 *
 * A trailing `token` segment marks a credential (`GITHUB_TOKEN`, `idToken`,
 * `oauthToken`). Plural `tokens` names in this codebase report usage
 * (`totalTokens`, `inputTokens`, `tokensBefore`), so the plural form is never
 * treated as a credential — including a bare `tokens` counter.
 */
export function isSensitiveLogKey(key: string): boolean {
	const segments = keySegments(key);
	if (segments.some((segment) => SENSITIVE_SEGMENTS[segment])) return true;

	if (segments[segments.length - 1] === "token") return true;

	for (let index = 0; index < segments.length - 1; index += 1) {
		const pair = `${segments[index]}${segments[index + 1]}`;
		if (SENSITIVE_PAIRS[pair]) return true;
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
			const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1, seen));
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
		? (sanitized as Record<string, unknown>)
		: {};
}

function writeThrough(sdk: SdkLogger, level: LogLevel, message: string, context: Record<string, unknown>): void {
	switch (level) {
		case "error":
			sdk.error(message, context);
			break;
		case "warn":
			sdk.warn(message, context);
			break;
		case "info":
			sdk.info(message, context);
			break;
		case "debug":
			sdk.debug(message, context);
			break;
	}
}

interface PendingRecord {
	level: LogLevel;
	message: string;
	context: Record<string, unknown>;
}

/**
 * Records written before this bundle resolved the SDK logger. Next compiles
 * instrumentation and route handlers separately, so a route gets its own copy
 * of this module with no `configureLogging` call; it must resolve the shared
 * transport on first use and then replay what it buffered.
 */
const pendingRecords: PendingRecord[] = [];
let runtimeBootstrap: Promise<void> | undefined;
let runtimeUnavailable = false;

/** Bounded so a stalled import cannot grow memory with a request backlog. */
const MAX_PENDING_RECORDS = 1_000;

async function bootstrapRuntime(): Promise<void> {
	try {
		const sdk = await ensureSdkLogger();
		if (!sdk) {
			runtimeUnavailable = true;
			pendingRecords.length = 0;
			return;
		}
		registerStdoutSink(sdk);
		if (transportState[TRANSPORTS_CONFIGURED] !== true) {
			transportState[STDOUT_MIRROR] = shouldMirrorStdout();
			sdk.setTransports({ file: true, console: false });
			transportState[TRANSPORTS_CONFIGURED] = true;
		}
		for (const record of pendingRecords.splice(0)) {
			writeThrough(sdk, record.level, record.message, record.context);
		}
		// 打包后的进程从不调用 `configureLogging`（`lib/` 只存在于仓库检出里），
		// 第一条记录触发的这里才是生产环境的启动点。
		startMemorySampling();
	} catch {
		// A transport that cannot be installed leaves nowhere to write. Drop the
		// backlog and stop buffering instead of rejecting an unobserved promise.
		runtimeUnavailable = true;
		pendingRecords.length = 0;
	}
}

function write(level: LogLevel, message: string, context: Record<string, unknown>): void {
	if (sdkLogger) {
		writeThrough(sdkLogger, level, message, context);
		return;
	}
	if (runtimeUnavailable) return;
	if (pendingRecords.length < MAX_PENDING_RECORDS) {
		pendingRecords.push({ level, message, context });
	}
	runtimeBootstrap ??= bootstrapRuntime().catch(() => {
		runtimeUnavailable = true;
		pendingRecords.length = 0;
	});
}

/**
 * 采样进程内存并写成 `process.memory`。
 *
 * 记录间隔随字段一起写入，读日志时不必再查环境变量；采样器在同一进程里只会启动一次，
 * 重复调用是空操作。
 */
function startMemorySampling(env: NodeJS.ProcessEnv = process.env): void {
	startMemoryMonitor({
		env,
		emit: (sample, intervalMs) => logEvent("debug", "process", "process.memory", { intervalMs, ...sample }),
	});
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
		// Ambient context only fills in correlation the caller did not state:
		// `agent.run.end` must keep the `requestId` it captured at `begin()`, even
		// when the run is finished from another request (an abort from a second
		// tab). `source` and `subsystem` stay fixed last so no field can spoof them.
		const context = sanitizeLogContext({
			...getLogContext(),
			...fields,
			source: LOG_SOURCE,
			subsystem,
		});
		write(level, message, context);
	} catch {
		// Logging is a side channel; callers never pay for its failures.
	}
}
