import { logEvent } from "@/lib/logging";
import { CLIENT_ADDRESS_HEADER, resolveForwardedAddress } from "@/lib/request-headers";
import { redactUrlsIn } from "@/lib/url-redaction";
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
 * set, URL redaction, truncation, per-session and per-address rate limits, and
 * a global ceiling across both.
 */

export const CLIENT_ERROR_EVENT = "client.error";
export const CLIENT_ERROR_SUBSYSTEM = "client";

/**
 * Wire cap for one report. The field limits are counted in characters while the
 * body is bounded in bytes, and a CJK character takes three bytes in UTF-8:
 * message (1,000) + stack (2,000) + url (1,000) + ids is about 12.8 KiB once
 * encoded, so 8 KiB silently dropped legitimate reports.
 */
export const CLIENT_LOG_MAX_BODY_BYTES = 16 * 1024;
export const CLIENT_ERROR_RATE_LIMIT = 20;
export const CLIENT_ERROR_RATE_WINDOW_MS = 60_000;
/**
 * Address bucket ceiling. Higher than the per-session limit because every tab
 * on one machine shares the same address (loopback requests are reported as
 * `local`); rotating `sessionId` still cannot exceed it.
 */
export const CLIENT_ERROR_ADDRESS_RATE_LIMIT = 60;
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

function requireStringField(body: Record<string, unknown>, field: string, limit: number, redact = false): string {
  const value = body[field];
  if (typeof value !== "string") {
    throw new ClientLogValidationError(400, `${field} must be a string`);
  }
  const normalized = normalizeClientField(redact ? redactUrlsIn(value) : value, limit);
  if (!normalized) throw new ClientLogValidationError(400, `${field} must not be empty`);
  return normalized;
}

function optionalStringField(
  body: Record<string, unknown>,
  field: string,
  limit: number,
  redact = false,
): string | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ClientLogValidationError(400, `${field} must be a string`);
  }
  return normalizeClientField(redact ? redactUrlsIn(value) : value, limit);
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
    message: requireStringField(body, "message", CLIENT_ERROR_MESSAGE_LIMIT, true),
  };
  const stack = optionalStringField(body, "stack", CLIENT_ERROR_STACK_LIMIT, true);
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
      const chunk = await reader.read().catch(async () => {
        // The client disconnected or the stream errored: release the body so
        // the socket is not held open, then report it as a bad request.
        await reader.cancel().catch(() => {});
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
 * Address bucket for a request. The proxy-written header is the address the
 * proxy actually observed; the forwarding headers are only a fallback for
 * callers that did not pass through it (tests, direct route use), and they are
 * read with the same trust rule as the proxy. Without a trusted proxy in front
 * both values are advisory, so the global ceiling below remains the hard bound.
 */
function clientAddress(request: Request): string {
  const proxied = request.headers.get(CLIENT_ADDRESS_HEADER)?.trim();
  return (proxied || resolveForwardedAddress(request.headers)).slice(0, 64);
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
  addressLimiter?: SlidingWindowLimiter;
  globalLimiter?: SlidingWindowLimiter;
  now?: () => number;
}

/** Build the ingestion handler. Exported so tests can inject limits and a clock. */
export function createClientLogHandler(options: ClientLogHandlerOptions = {}) {
  const limiter = options.limiter ?? new SlidingWindowLimiter(CLIENT_ERROR_RATE_LIMIT, CLIENT_ERROR_RATE_WINDOW_MS);
  const addressLimiter =
    options.addressLimiter ?? new SlidingWindowLimiter(CLIENT_ERROR_ADDRESS_RATE_LIMIT, CLIENT_ERROR_RATE_WINDOW_MS);
  const globalLimiter =
    options.globalLimiter ?? new SlidingWindowLimiter(CLIENT_ERROR_GLOBAL_RATE_LIMIT, CLIENT_ERROR_RATE_WINDOW_MS, 1);
  const now = options.now ?? (() => Date.now());

  return async function handleClientLog(request: Request): Promise<Response> {
    try {
      const at = now();
      // Header-only, so it runs before the body is read: a flood from one
      // address is rejected without parsing the JSON body per request. A
      // caller rotating `sessionId` cannot reset this bucket.
      const address = clientAddress(request);
      const perAddress = addressLimiter.take(`client:${address}`, at);
      if (!perAddress.allowed) return rateLimited(perAddress.retryAfterMs);

      if (!hasJsonContentType(request)) {
        throw new ClientLogValidationError(415, "Content-Type must be application/json");
      }
      const payload = await readJsonWithinLimit(request, CLIENT_LOG_MAX_BODY_BYTES);
      const report = parseClientErrorReport(payload);

      // Reject a flooding session before it can drain the shared bucket; only
      // an accepted per-key request spends a global slot. Without a session id
      // the key is the address that the first bucket already counted.
      const sessionKey = report.sessionId ? `session:${report.sessionId}` : `address:${address}`;
      const perKey = limiter.take(sessionKey, at);
      if (!perKey.allowed) return rateLimited(perKey.retryAfterMs);
      const global = globalLimiter.take("all", at);
      if (!global.allowed) return rateLimited(global.retryAfterMs);

      recordClientError(report);
      return new Response(null, { status: 204, headers: NO_STORE });
    } catch (error) {
      if (error instanceof ClientLogValidationError) {
        return Response.json({ error: error.message }, { status: error.status, headers: NO_STORE });
      }
      throw error;
    }
  };
}
