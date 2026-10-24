import { getLogContext, logEvent, type LogLevel } from "@/lib/logging";
import { REQUEST_ID_HEADER } from "@/lib/request-headers";

/**
 * SSE lifecycle records for the streaming routes.
 *
 * A streaming response outlives the handler that returned its headers, so
 * `http.request` cannot describe it: the request duration stops at the response
 * headers while the connection keeps writing frames. These helpers write
 * `http.stream.open` / `http.stream.close` instead, and keep the close reason in
 * one place so both SSE routes report the same fields.
 */

/** Heartbeat cadence shared by the SSE routes; a proxy timeout would otherwise end an idle stream. */
export const SSE_HEARTBEAT_MS = 30_000;

/** Every way an SSE stream can end. */
export type SseCloseReason =
  | "cancelled"
  | "aborted"
  | "controller_closed"
  | "heartbeat_failed";

const CLOSE_LEVEL: Record<SseCloseReason, LogLevel> = {
  cancelled: "info",
  aborted: "info",
  controller_closed: "warn",
  heartbeat_failed: "warn",
};

interface SseLogFields {
  route: string;
  requestId: string;
  sessionId?: string;
  runtimeId?: string;
}

/** Correlation id from the request wrapper, then the proxy header; direct calls get a fresh one. */
export function resolveSseRequestId(request: Request): string {
  return getLogContext()?.requestId
    || request.headers.get(REQUEST_ID_HEADER)?.trim()
    || globalThis.crypto.randomUUID();
}

function correlationFields(fields: SseLogFields): Record<string, unknown> {
  return {
    requestId: fields.requestId,
    route: fields.route,
    ...(fields.sessionId ? { sessionId: fields.sessionId } : {}),
    ...(fields.runtimeId ? { runtimeId: fields.runtimeId } : {}),
  };
}

export interface SseLifecycle {
  readonly closed: boolean;
  /** Write `http.stream.open` once. */
  open(): void;
  /** Write `http.stream.close` once; later calls are ignored and report `false`. */
  close(reason: SseCloseReason): boolean;
}

export interface SseLifecycleOptions {
  /** Millisecond clock used for the alive duration; tests pass a fake. */
  now?: () => number;
}

export function createSseLifecycle(
  fields: SseLogFields,
  options: SseLifecycleOptions = {},
): SseLifecycle {
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  let closed = false;

  return {
    get closed() {
      return closed;
    },
    open() {
      logEvent("info", "http", "http.stream.open", correlationFields(fields));
    },
    close(reason) {
      if (closed) return false;
      closed = true;
      logEvent(CLOSE_LEVEL[reason], "http", "http.stream.close", {
        ...correlationFields(fields),
        reason,
        durationMs: Math.max(0, Math.round(now() - startedAt)),
      });
      return true;
    },
  };
}

/** The subset of `ReadableStreamDefaultController` the lifecycle needs. */
export interface SseStreamController {
  enqueue(chunk: Uint8Array): void;
  close(): void;
}

export interface SseStreamOptions {
  controller: SseStreamController;
  request: Request;
  route: string;
  sessionId?: string;
  runtimeId?: string;
  /**
   * Emits the initial frames and wires the subscriptions, returning their
   * unsubscribe function. Runs after `http.stream.open`; the route keeps its
   * existing frame order (connected-first for agent events, subscribe-first for
   * running sessions).
   */
  connect: (send: (data: unknown) => boolean) => () => void;
  heartbeatMs?: number;
  now?: () => number;
  /** Starts the heartbeat; returns the function that stops it. Tests pass a manual timer. */
  scheduleInterval?: (handler: () => void, ms: number) => () => void;
}

export interface SseStreamSession {
  /** The client stopped reading the response body. */
  cancel(): void;
}

/**
 * Wire one SSE connection: open record, frame writer, heartbeat, abort and
 * cancel handling, and a single close record. Cleanup order matches the routes'
 * original order (stop heartbeat, unsubscribe, close the controller), and the
 * close record is written after cleanup so its duration covers the connection.
 */
export function openSseStream(options: SseStreamOptions): SseStreamSession {
  const {
    controller,
    request,
    route,
    sessionId,
    runtimeId,
    connect,
    heartbeatMs = SSE_HEARTBEAT_MS,
    now = () => performance.now(),
    scheduleInterval = (handler, ms) => {
      const timer = setInterval(handler, ms);
      return () => clearInterval(timer);
    },
  } = options;

  const encoder = new TextEncoder();
  const lifecycle = createSseLifecycle(
    { route, requestId: resolveSseRequestId(request), sessionId, runtimeId },
    { now },
  );
  lifecycle.open();

  // Filled in as the connection is wired; `stop` can run before either exists.
  const connection: {
    unsubscribe?: () => void;
    stopHeartbeat?: () => void;
  } = {};
  let finished = false;

  const stop = (reason: SseCloseReason, closeController: boolean) => {
    if (finished) return;
    finished = true;
    connection.stopHeartbeat?.();
    connection.unsubscribe?.();
    if (closeController) {
      try {
        controller.close();
      } catch {
        // The runtime already closed the controller.
      }
    }
    lifecycle.close(reason);
  };

  const write = (chunk: string, reason: SseCloseReason): boolean => {
    if (finished) return false;
    try {
      controller.enqueue(encoder.encode(chunk));
      return true;
    } catch {
      // A closed controller cannot emit a close event through the response, so
      // record why the stream ended and stop producing.
      stop(reason, false);
      return false;
    }
  };

  const send = (data: unknown) => write(`data: ${JSON.stringify(data)}\n\n`, "controller_closed");

  connection.unsubscribe = connect(send);
  if (finished) {
    // `connect` already failed to write: drop the subscription it just created.
    connection.unsubscribe();
    return { cancel: () => stop("cancelled", false) };
  }

  connection.stopHeartbeat = scheduleInterval(() => {
    write(":\n\n", "heartbeat_failed");
  }, heartbeatMs);

  request.signal?.addEventListener("abort", () => stop("aborted", true));

  return { cancel: () => stop("cancelled", false) };
}
