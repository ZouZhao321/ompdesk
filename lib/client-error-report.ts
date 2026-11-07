/**
 * Browser-side error reporting.
 *
 * This module runs in the browser bundle, so it must stay free of Node.js
 * imports. The `POST /api/client-logs` handler imports the same limits, the
 * truncation helper, and the rate limiter so both sides agree on the payload.
 *
 * Only a fixed set of string fields leaves the browser: a thrown error's
 * message and stack, the page path, the session id from the URL, and the build
 * version. Prompt text, chat content, and arbitrary rejection reasons are never
 * serialized; URLs embedded in a message or stack are stripped of credentials,
 * query values, and fragments before they leave the page.
 */

import { redactUrlsIn } from "@/lib/url-redaction";

/** Where the reporter posts. Protected by the proxy's host, origin, and auth checks. */
export const CLIENT_LOG_ENDPOINT = "/api/client-logs";

export const CLIENT_ERROR_KINDS = ["error", "unhandledrejection"] as const;
export type ClientErrorKind = (typeof CLIENT_ERROR_KINDS)[number];

export const CLIENT_ERROR_MESSAGE_LIMIT = 1_000;
export const CLIENT_ERROR_STACK_LIMIT = 2_000;
export const CLIENT_ERROR_URL_LIMIT = 1_000;
export const CLIENT_ERROR_SESSION_ID_LIMIT = 128;
export const CLIENT_ERROR_BUILD_VERSION_LIMIT = 64;

/** Reports one page may send per window, independent of the server's limit. */
export const CLIENT_ERROR_REPORT_LIMIT = 20;
export const CLIENT_ERROR_REPORT_WINDOW_MS = 60_000;
/** The same failure repeating inside this window is reported once. */
export const CLIENT_ERROR_DUPLICATE_WINDOW_MS = 5_000;
export const CLIENT_ERROR_DUPLICATE_CAPACITY = 32;

export interface ClientErrorReport {
  kind: ClientErrorKind;
  message: string;
  stack?: string;
  url?: string;
  sessionId?: string;
  buildVersion?: string;
}

export interface ClientErrorInput {
  kind: ClientErrorKind;
  /** The thrown value. Only `Error`-shaped values (including DOMException) contribute text. */
  error?: unknown;
  /** Fallback text, used for `ErrorEvent.message` and for non-error rejections. */
  message?: string;
  url?: string;
  sessionId?: string | null;
  buildVersion?: string;
}

export function isClientErrorKind(value: unknown): value is ClientErrorKind {
  return value === "error" || value === "unhandledrejection";
}

/** The marker `truncateClientField` appends, so an already-truncated field is left alone. */
const TRUNCATION_MARKER = /… \[truncated (\d+) chars\]$/;

/**
 * Cut `value` to `limit` characters, marking the removed tail like the server
 * logger does. Idempotent: a value that already ends in a truncation marker
 * keeps it (and its original count), so the client and the server can both
 * apply this without losing the real truncated length.
 */
export function truncateClientField(value: string, limit: number): string {
  const cap = Math.max(0, Math.trunc(limit));
  const marker = TRUNCATION_MARKER.exec(value);
  const body = marker ? value.slice(0, value.length - marker[0].length) : value;
  if (body.length <= cap) return value;
  const removed = body.length - cap + (marker ? Number(marker[1]) : 0);
  return `${body.slice(0, cap)}… [truncated ${removed} chars]`;
}

/** Trim, reject empty values, and cut the rest to `limit`. */
export function normalizeClientField(
  value: string | null | undefined,
  limit: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return truncateClientField(trimmed, limit);
}

/**
 * Reduce a page URL to its path so query strings and fragments never leave the
 * browser. Absolute URLs are accepted but keep only the pathname.
 */
export function normalizeClientUrl(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  let path = trimmed.split(/[?#]/, 1)[0] ?? "";
  try {
    path = new URL(trimmed, "http://ompdesk.invalid").pathname;
  } catch {
    // Not parseable as a URL: fall back to the pre-query text.
  }
  const normalized = path.trim();
  return normalized ? truncateClientField(normalized, CLIENT_ERROR_URL_LIMIT) : undefined;
}

/** Read `?session=` from the current location without trusting any other parameter. */
export function readSessionId(search: string | null | undefined): string | undefined {
  if (!search) return undefined;
  const query = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  return normalizeClientField(query.get("session"), CLIENT_ERROR_SESSION_ID_LIMIT);
}

function isErrorLike(value: unknown): value is { message?: unknown; stack?: unknown } {
  if (value instanceof Error) return true;
  if (!value || typeof value !== "object") return false;
  // Cross-realm errors fail `instanceof`; DOMException (AbortError,
  // QuotaExceededError, clipboard failures) has its own toString tag.
  const tag = Object.prototype.toString.call(value);
  return tag === "[object Error]" || tag === "[object DOMException]";
}

function describeReason(error: unknown): { message: string; stack?: string } {
  if (isErrorLike(error)) {
    return {
      message: typeof error.message === "string" ? error.message : "",
      stack: typeof error.stack === "string" ? error.stack : undefined,
    };
  }
  // Anything else — including a string rejection, which is usually upstream
  // response text — is an arbitrary reason and must not be serialized.
  return { message: "" };
}

/**
 * Build the bounded payload for one browser failure. Every field is optional
 * except the kind and a non-empty message, which falls back to a generic label
 * rather than serializing an unknown value.
 */
export function buildClientErrorReport(input: ClientErrorInput): ClientErrorReport {
  const described = describeReason(input.error);
  const rawMessage = described.message || input.message;
  const message =
    normalizeClientField(
      rawMessage ? redactUrlsIn(rawMessage) : undefined,
      CLIENT_ERROR_MESSAGE_LIMIT,
    ) ??
    (input.kind === "unhandledrejection" ? "Unhandled promise rejection" : "Uncaught exception");

  const report: ClientErrorReport = { kind: input.kind, message };
  const stack = normalizeClientField(
    described.stack ? redactUrlsIn(described.stack) : undefined,
    CLIENT_ERROR_STACK_LIMIT,
  );
  if (stack) report.stack = stack;
  const url = normalizeClientUrl(input.url);
  if (url) report.url = url;
  const sessionId = normalizeClientField(input.sessionId, CLIENT_ERROR_SESSION_ID_LIMIT);
  if (sessionId) report.sessionId = sessionId;
  const buildVersion = normalizeClientField(input.buildVersion, CLIENT_ERROR_BUILD_VERSION_LIMIT);
  if (buildVersion) report.buildVersion = buildVersion;
  return report;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Milliseconds until the oldest hit leaves the window; 0 when allowed. */
  retryAfterMs: number;
}

/**
 * Fixed-size sliding-window limiter keyed by caller. Used in the browser to
 * bound network traffic and on the server to bound writes per session or
 * address. State is in memory on purpose: a restart is a clean slate, and the
 * log file is the durable record.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 500,
  ) {}

  take(key: string, now = Date.now()): RateLimitDecision {
    const cutoff = now - this.windowMs;
    const hits = (this.hits.get(key) ?? []).filter((at) => at > cutoff);
    if (hits.length >= this.limit) {
      this.hits.set(key, hits);
      // `hits` is empty when the limit is ≤ 0: fall back to the full window
      // instead of producing `Retry-After: NaN`.
      const oldest = hits[0] ?? now;
      return {
        allowed: false,
        retryAfterMs: Math.max(1, oldest + this.windowMs - now),
      };
    }
    hits.push(now);
    this.hits.set(key, hits);
    this.prune(now);
    return { allowed: true, retryAfterMs: 0 };
  }

  private prune(now: number): void {
    if (this.hits.size <= this.maxKeys) return;
    const cutoff = now - this.windowMs;
    for (const [key, hits] of this.hits) {
      const kept = hits.filter((at) => at > cutoff);
      if (kept.length === 0) this.hits.delete(key);
      else this.hits.set(key, kept);
    }
    // Evict the least recently active bucket, not the first inserted one: a
    // map's iteration order is insertion order, which would let a caller
    // rotating keys reset a hot bucket's count.
    while (this.hits.size > this.maxKeys) {
      let oldestKey: string | undefined;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [key, hits] of this.hits) {
        const last = hits[hits.length - 1] ?? Number.NEGATIVE_INFINITY;
        if (last < oldestAt) {
          oldestAt = last;
          oldestKey = key;
        }
      }
      if (oldestKey === undefined) return;
      this.hits.delete(oldestKey);
    }
  }
}

function reportSignature(report: ClientErrorReport): string {
  const frames = report.stack?.split("\n").slice(0, 3).join("\n") ?? "";
  return `${report.kind}\u0000${report.message}\u0000${frames}`;
}

/**
 * Remember recent signatures so an error loop (or a framework that rethrows an
 * event) produces one report per window instead of one per dispatch.
 */
export class ClientErrorDeduplicator {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly windowMs = CLIENT_ERROR_DUPLICATE_WINDOW_MS,
    private readonly capacity = CLIENT_ERROR_DUPLICATE_CAPACITY,
  ) {}

  shouldReport(report: ClientErrorReport, now = Date.now()): boolean {
    const signature = reportSignature(report);
    const last = this.seen.get(signature);
    if (last !== undefined && now - last < this.windowMs) return false;
    this.seen.delete(signature);
    this.seen.set(signature, now);
    while (this.seen.size > this.capacity) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
    return true;
  }
}

interface ListenerTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

interface ReporterLocation {
  pathname?: string;
  search?: string;
}

export interface InstallClientErrorReporterOptions {
  /** Defaults to `window`. */
  target?: ListenerTarget | null;
  /** Defaults to the global `fetch`. */
  fetch?: ((input: string, init?: RequestInit) => Promise<unknown>) | null;
  /** Defaults to `window.location`. */
  location?: ReporterLocation | null;
  buildVersion?: string;
  dedupe?: ClientErrorDeduplicator;
  limiter?: SlidingWindowLimiter;
  now?: () => number;
}

function defaultTarget(): ListenerTarget | null {
  const candidate = globalThis as unknown as Partial<ListenerTarget>;
  return typeof candidate.addEventListener === "function" &&
    typeof candidate.removeEventListener === "function"
    ? (candidate as ListenerTarget)
    : null;
}

function defaultLocation(): ReporterLocation | null {
  const candidate = (globalThis as unknown as { location?: ReporterLocation }).location;
  return candidate ?? null;
}

/**
 * Listen for uncaught exceptions and unhandled rejections, then post a bounded
 * report for each distinct failure. Returns an uninstall function.
 *
 * This deliberately does not wrap `console.error`: the app's own error logging
 * keeps working, and only real uncaught failures leave the page.
 */
export function installClientErrorReporter(
  options: InstallClientErrorReporterOptions = {},
): () => void {
  const target = options.target ?? defaultTarget();
  const fetchImpl =
    options.fetch ??
    (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null);
  if (!target || !fetchImpl) return () => {};

  const location = options.location ?? defaultLocation();
  const dedupe = options.dedupe ?? new ClientErrorDeduplicator();
  const limiter =
    options.limiter ??
    new SlidingWindowLimiter(CLIENT_ERROR_REPORT_LIMIT, CLIENT_ERROR_REPORT_WINDOW_MS);
  const now = options.now ?? (() => Date.now());

  const report = (
    kind: ClientErrorKind,
    error: unknown,
    fallbackMessage: string | undefined,
  ): void => {
    const at = now();
    const payload = buildClientErrorReport({
      kind,
      error,
      message: fallbackMessage,
      url: location?.pathname,
      sessionId: readSessionId(location?.search),
      buildVersion: options.buildVersion,
    });
    if (!dedupe.shouldReport(payload, at)) return;
    if (!limiter.take("page", at).allowed) return;

    try {
      void Promise.resolve(
        fetchImpl(CLIENT_LOG_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: true,
        }),
      ).catch(() => {
        // Reporting is a side channel; a failed post must not surface to the user.
      });
    } catch {
      // A synchronous transport failure is equally invisible.
    }
  };

  const onError = (event: Event): void => {
    const errorEvent = event as ErrorEvent;
    // Resource load failures (a missing image, a blocked script) dispatch an
    // `error` event without a message or an error object.
    if (!errorEvent.message && !errorEvent.error) return;
    report("error", errorEvent.error, errorEvent.message);
  };

  const onUnhandledRejection = (event: Event): void => {
    const rejectionEvent = event as PromiseRejectionEvent;
    report("unhandledrejection", rejectionEvent.reason, undefined);
  };

  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onUnhandledRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}
