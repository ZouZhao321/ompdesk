import { logEvent } from "@/lib/logging";
import { hasJsonContentType } from "@/lib/request-security";
import {
  CLIENT_ERROR_BUILD_VERSION_LIMIT,
  CLIENT_ERROR_MESSAGE_LIMIT,
  CLIENT_ERROR_SESSION_ID_LIMIT,
  CLIENT_ERROR_STACK_LIMIT,
  CLIENT_ERROR_URL_LIMIT,
  normalizeClientField,
  normalizeClientUrl,
  SlidingWindowLimiter,
  truncateClientField,
  isClientErrorKind,
  type ClientErrorReport,
} from "@/lib/client-error-report";

/**
 * Server side of browser error reporting.
 *
 * The proxy has already enforced host, origin, and password checks before a
 * request reaches this handler. What is left is to bound what a compromised or
 * broken page can write: JSON only, one small body per request, a fixed field
 * set, truncation, and a per-session (or per-address) rate limit.
 */

export const CLIENT_ERROR_EVENT = "client.error";
export const CLIENT_ERROR_SUBSYSTEM = "client";

export const CLIENT_LOG_MAX_BODY_BYTES = 8 * 1024;
export const CLIENT_ERROR_RATE_LIMIT = 20;
export const CLIENT_ERROR_RATE_WINDOW_MS = 60_000;
/** Ceiling across every session and address, so rotating ids cannot outrun it. */
export const CLIENT_ERROR_GLOBAL_RATE_LIMIT = 200;

const NO_STORE = { "Cache-Control": "no-store" };

const CLIENT_ERROR_FIELDS: Record<string, true> = {
  kind: true,
  message: true,
  stack: true,
  url: true,
  sessionId: true,
  buildVersion: true,
};

/** A rejected report; `status` is the response code the handler returns. */
export class ClientLogValidationError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ClientLogValidationError";
    this.status = status;
  }
}

function requireStringField(
  body: Record<string, unknown>,
  field: string,
  limit: number,
): string {
  const value = body[field];
  if (typeof value !== "string") {
    throw new ClientLogValidationError(400, `${field} must be a string`);
  }
  const normalized = normalizeClientField(value, limit);
  if (!normalized) throw new ClientLogValidationError(400, `${field} must not be empty`);
  return normalized;
}

function optionalStringField(
  body: Record<string, unknown>,
  field: string,
  limit: number,
): string | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ClientLogValidationError(400, `${field} must be a string`);
  }
  return normalizeClientField(value, limit);
}

/**
 * Validate one decoded body. Unknown keys are rejected instead of ignored: the
 * endpoint must never become a way to smuggle prompts, message content, or
 * arbitrary objects into the log file.
 */
export function parseClientErrorReport(payload: unknown): ClientErrorReport {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ClientLogValidationError(400, "A JSON object is required");
  }
  const body = payload as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (!Object.hasOwn(CLIENT_ERROR_FIELDS, key)) {
      throw new ClientLogValidationError(400, `Unsupported field: ${truncateClientField(key, 32)}`);
    }
  }
  if (!isClientErrorKind(body.kind)) {
    throw new ClientLogValidationError(400, "kind must be error or unhandledrejection");
  }

  const report: ClientErrorReport = {
    kind: body.kind,
    message: requireStringField(body, "message", CLIENT_ERROR_MESSAGE_LIMIT),
  };
  const stack = optionalStringField(body, "stack", CLIENT_ERROR_STACK_LIMIT);
  if (stack) report.stack = stack;
  const url = normalizeClientUrl(optionalStringField(body, "url", CLIENT_ERROR_URL_LIMIT));
  if (url) report.url = url;
  const sessionId = optionalStringField(body, "sessionId", CLIENT_ERROR_SESSION_ID_LIMIT);
  if (sessionId) report.sessionId = sessionId;
  const buildVersion = optionalStringField(body, "buildVersion", CLIENT_ERROR_BUILD_VERSION_LIMIT);
  if (buildVersion) report.buildVersion = buildVersion;
  return report;
}

/**
 * Write one `client.error` record. The log record's `message` field is the
 * stable event name, so the reported text and stack live under `error`, the
 * same shape `http.request` uses for handled failures. `logEvent` then applies
 * the shared sanitizer (key redaction, depth, and length limits).
 */
export function recordClientError(report: ClientErrorReport): void {
  const error: Record<string, unknown> = { message: report.message };
  if (report.stack) error.stack = report.stack;
  logEvent("error", CLIENT_ERROR_SUBSYSTEM, CLIENT_ERROR_EVENT, {
    kind: report.kind,
    ...(report.url ? { url: report.url } : {}),
    ...(report.sessionId ? { sessionId: report.sessionId } : {}),
    ...(report.buildVersion ? { buildVersion: report.buildVersion } : {}),
    error,
  });
}

function declaredContentLength(request: Request): number | null {
  const value = request.headers.get("content-length");
  if (!value || !/^\d+$/.test(value)) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : null;
}

/**
 * Decode a JSON body while the wire bytes are bounded. `Content-Length` is
 * checked first so an oversized upload is rejected without reading it; chunked
 * bodies are cut off once they cross the cap.
 */
async function readJsonWithinLimit(request: Request, maxBytes: number): Promise<unknown> {
  const declared = declaredContentLength(request);
  if (declared !== null && declared > maxBytes) {
    throw new ClientLogValidationError(413, "Request body is too large");
  }

  const reader = request.body?.getReader();
  if (!reader) throw new ClientLogValidationError(400, "A JSON body is required");

  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read().catch(() => {
        // The client disconnected or the stream errored: that is a bad request,
        // not a server failure worth a 500 and a `failed: true` request log.
        throw new ClientLogValidationError(400, "Request body could not be read");
      });
      const { done, value } = chunk;
      if (done) break;
      if (size + value.byteLength > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new ClientLogValidationError(413, "Request body is too large");
      }
      size += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ClientLogValidationError(400, "Request body must be valid JSON");
  }
}

/**
 * Rate-limit identity: the reported session when it has one, otherwise the
 * forwarding address. The value only selects a bucket; spoofing it cannot grant
 * access, because the proxy has already authenticated the caller.
 */
function rateLimitKey(report: ClientErrorReport, request: Request): string {
  if (report.sessionId) return `session:${report.sessionId}`;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip")?.trim() || "local";
  return `address:${address.slice(0, 64)}`;
}

function rateLimited(retryAfterMs: number): Response {
  return Response.json(
    { error: "Too many client error reports" },
    {
      status: 429,
      headers: {
        ...NO_STORE,
        "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1_000))),
      },
    },
  );
}

export interface ClientLogHandlerOptions {
  limiter?: SlidingWindowLimiter;
  globalLimiter?: SlidingWindowLimiter;
  now?: () => number;
}

/** Build the ingestion handler. Exported so tests can inject limits and a clock. */
export function createClientLogHandler(options: ClientLogHandlerOptions = {}) {
  const limiter = options.limiter
    ?? new SlidingWindowLimiter(CLIENT_ERROR_RATE_LIMIT, CLIENT_ERROR_RATE_WINDOW_MS);
  const globalLimiter = options.globalLimiter
    ?? new SlidingWindowLimiter(CLIENT_ERROR_GLOBAL_RATE_LIMIT, CLIENT_ERROR_RATE_WINDOW_MS, 1);
  const now = options.now ?? (() => Date.now());

  return async function handleClientLog(request: Request): Promise<Response> {
    try {
      if (!hasJsonContentType(request)) {
        throw new ClientLogValidationError(415, "Content-Type must be application/json");
      }
      const payload = await readJsonWithinLimit(request, CLIENT_LOG_MAX_BODY_BYTES);
      const report = parseClientErrorReport(payload);

      const at = now();
      // Reject a flooding session before it can drain the shared bucket; only
      // an accepted per-key request spends a global slot.
      const perKey = limiter.take(rateLimitKey(report, request), at);
      if (!perKey.allowed) return rateLimited(perKey.retryAfterMs);
      const global = globalLimiter.take("all", at);
      if (!global.allowed) return rateLimited(global.retryAfterMs);

      recordClientError(report);
      return new Response(null, { status: 204, headers: NO_STORE });
    } catch (error) {
      if (error instanceof ClientLogValidationError) {
        return Response.json(
          { error: error.message },
          { status: error.status, headers: NO_STORE },
        );
      }
      throw error;
    }
  };
}
