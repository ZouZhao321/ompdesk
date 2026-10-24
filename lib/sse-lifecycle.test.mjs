import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { configureLogging, flushLogs } = await import("./logging.ts");
const { openSseStream, resolveSseRequestId, SSE_HEARTBEAT_MS } = await import(
  "./sse-lifecycle.ts"
);

function createLogDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-sse-lifecycle-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function readRecords(dir) {
  const records = [];
  for (const name of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, name), "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) records.push(JSON.parse(line));
    }
  }
  return records;
}

async function useTempTransport(t) {
  const dir = createLogDir(t);
  await configureLogging({ file: dir, stdout: false, env: { NODE_ENV: "production" } });
  return dir;
}

function makeController() {
  const controller = {
    chunks: [],
    closed: false,
    failEnqueue: false,
    enqueue(chunk) {
      if (controller.failEnqueue || controller.closed) throw new Error("controller closed");
      controller.chunks.push(new TextDecoder().decode(chunk));
    },
    close() {
      controller.closed = true;
    },
  };
  return controller;
}

function makeFakeSession() {
  const listeners = new Set();
  let unsubscribes = 0;
  return {
    get unsubscribes() {
      return unsubscribes;
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => {
        unsubscribes += 1;
        listeners.delete(listener);
      };
    },
    emit(event) {
      for (const listener of [...listeners]) listener(event);
    },
  };
}

function makeClock(start = 1_000) {
  let value = start;
  return {
    now: () => value,
    advance(ms) {
      value += ms;
    },
  };
}

function makeManualScheduler() {
  const calls = [];
  return {
    calls,
    schedule(handler, ms) {
      calls.push({ handler, ms });
      return () => {};
    },
  };
}

function makeRequest({ requestId = "req-sse-fixed", signal } = {}) {
  const headers = requestId ? { "x-ompdesk-request-id": requestId } : {};
  return new Request("http://localhost:30141/api/agent/session-1/events", { headers, signal });
}

function openStream(overrides = {}) {
  const controller = overrides.controller ?? makeController();
  const session = overrides.session ?? makeFakeSession();
  const clock = overrides.clock ?? makeClock();
  let streamSession;
  const handle = openSseStream({
    controller,
    request: overrides.request ?? makeRequest(),
    route: overrides.route ?? "/api/agent/[id]/events",
    sessionId: overrides.sessionId ?? "session-1",
    runtimeId: overrides.runtimeId ?? "runtime-1",
    connect: (send) => {
      send({ type: "connected", sessionId: "session-1", runtimeId: "runtime-1" });
      return session.onEvent((event) => send(event));
    },
    now: clock.now,
    scheduleInterval:
      overrides.schedule ??
      ((handler, ms) => {
        const timer = setInterval(handler, ms);
        return () => clearInterval(timer);
      }),
  });
  streamSession = handle;
  return { streamSession, controller, session, clock };
}

function findRecord(records, message, reason) {
  const record = records.find(
    (entry) => entry.message === message && (reason === undefined || entry.reason === reason),
  );
  assert.ok(
    record,
    `expected ${message}${reason ? ` (${reason})` : ""} record, got ${JSON.stringify(records)}`,
  );
  return record;
}

test("logs stream open with request correlation and keeps forwarding events", async (t) => {
  const dir = await useTempTransport(t);
  const { streamSession, controller, session } = openStream();

  session.emit({ type: "turn_end" });
  flushLogs();

  const open = findRecord(readRecords(dir), "http.stream.open");
  assert.equal(open.level, "info");
  assert.equal(open.subsystem, "http");
  assert.equal(open.source, "ompdesk");
  assert.equal(open.requestId, "req-sse-fixed");
  assert.equal(open.route, "/api/agent/[id]/events");
  assert.equal(open.sessionId, "session-1");
  assert.equal(open.runtimeId, "runtime-1");

  assert.equal(controller.chunks.length, 2);
  assert.equal(controller.chunks[0], 'data: {"type":"connected","sessionId":"session-1","runtimeId":"runtime-1"}\n\n');
  assert.equal(controller.chunks[1], 'data: {"type":"turn_end"}\n\n');

  streamSession.cancel();
});

test("records cancellation with the alive duration and unsubscribes once", async (t) => {
  const dir = await useTempTransport(t);
  const { streamSession, session, clock } = openStream();

  clock.advance(4_200);
  streamSession.cancel();
  streamSession.cancel();
  flushLogs();

  const close = findRecord(readRecords(dir), "http.stream.close", "cancelled");
  assert.equal(close.level, "info");
  assert.equal(close.requestId, "req-sse-fixed");
  assert.equal(close.sessionId, "session-1");
  assert.equal(close.runtimeId, "runtime-1");
  assert.equal(close.durationMs, 4_200);
  assert.equal(session.unsubscribes, 1);

  const closes = readRecords(dir).filter((entry) => entry.message === "http.stream.close");
  assert.equal(closes.length, 1);
});

test("records an aborted request and closes the controller", async (t) => {
  const dir = await useTempTransport(t);
  const abort = new AbortController();
  const { session, controller, clock } = openStream({
    request: makeRequest({ signal: abort.signal }),
  });

  clock.advance(750);
  abort.abort();
  flushLogs();

  const close = findRecord(readRecords(dir), "http.stream.close", "aborted");
  assert.equal(close.durationMs, 750);
  assert.equal(controller.closed, true);
  assert.equal(session.unsubscribes, 1);
});

test("records a heartbeat failure as an abnormal close", async (t) => {
  const dir = await useTempTransport(t);
  const scheduler = makeManualScheduler();
  const { controller, session, clock } = openStream({ schedule: scheduler.schedule });

  controller.failEnqueue = true;
  clock.advance(30_000);
  assert.equal(scheduler.calls[0].ms, SSE_HEARTBEAT_MS);
  scheduler.calls[0].handler();
  flushLogs();

  const close = findRecord(readRecords(dir), "http.stream.close", "heartbeat_failed");
  assert.equal(close.level, "warn");
  assert.equal(close.durationMs, 30_000);
  assert.equal(session.unsubscribes, 1);
  assert.equal(controller.closed, false);
});

test("records a closed controller when forwarding an event fails", async (t) => {
  const dir = await useTempTransport(t);
  const { controller, session } = openStream();

  controller.failEnqueue = true;
  session.emit({ type: "agent_end" });
  flushLogs();

  const close = findRecord(readRecords(dir), "http.stream.close", "controller_closed");
  assert.equal(close.level, "warn");
  assert.equal(session.unsubscribes, 1);

  session.emit({ type: "agent_end" });
  assert.equal(readRecords(dir).filter((entry) => entry.message === "http.stream.close").length, 1);
});

test("records one close when wiring the connection throws", async (t) => {
  const dir = await useTempTransport(t);
  const controller = makeController();
  const failure = new Error("subscribe failed");

  assert.throws(
    () =>
      openSseStream({
        controller,
        request: makeRequest(),
        route: "/api/agent/[id]/events",
        connect: () => {
          throw failure;
        },
      }),
    (caught) => caught === failure,
  );
  flushLogs();

  const records = readRecords(dir);
  const opens = records.filter((entry) => entry.message === "http.stream.open");
  const closes = records.filter((entry) => entry.message === "http.stream.close");
  assert.equal(opens.length, 1);
  assert.equal(closes.length, 1);
  assert.equal(closes[0].reason, "controller_closed");
  assert.equal(closes[0].level, "warn");
  assert.equal(controller.closed, true);
});

test("resolves the request id from the proxy header and falls back to a fresh id", () => {
  assert.equal(resolveSseRequestId(makeRequest({ requestId: "req-from-proxy" })), "req-from-proxy");
  assert.match(
    resolveSseRequestId(makeRequest({ requestId: "" })),
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
});

test("prefers the request wrapper's correlation id over the header", async () => {
  const { runWithLogContext } = await import("./logging.ts");
  const requestId = runWithLogContext({ requestId: "req-from-wrapper" }, () =>
    resolveSseRequestId(makeRequest({ requestId: "req-from-header" })),
  );
  assert.equal(requestId, "req-from-wrapper");
});

test("request duration stops at the response headers, not at stream close", async (t) => {
  const dir = await useTempTransport(t);
  const { withRequestLog } = await import("./api-request-log.ts");
  const wrapped = withRequestLog("/api/agent/[id]/events", async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(":keep-alive\n\n"));
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    ),
  );

  const response = await wrapped(makeRequest({ requestId: "req-header" }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  flushLogs();

  const request = findRecord(readRecords(dir), "http.request");
  assert.equal(request.requestId, "req-header");
  assert.ok(request.durationMs < 50, `duration counted the live stream: ${request.durationMs}`);

  await response.body?.cancel();
});
