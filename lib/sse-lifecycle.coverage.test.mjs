import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const { configureLogging, flushLogs } = await import("./logging.ts");
const { openSseStream, SSE_HEARTBEAT_MS } = await import("./sse-lifecycle.ts");

const workDir = path.join(process.cwd(), ".tmp", "lib-logic-two");
const logsDir = path.join(workDir, `sse-${process.pid}-${Date.now()}`);
fs.mkdirSync(logsDir, { recursive: true });
await configureLogging({ file: logsDir, stdout: false, env: { NODE_ENV: "production" } });
test.after(() => {
  flushLogs();
  fs.rmSync(logsDir, { recursive: true, force: true });
});

function readRecords() {
  return fs
    .readdirSync(logsDir)
    .flatMap((name) => fs.readFileSync(path.join(logsDir, name), "utf8").split(/\r?\n/))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function makeController({ failEnqueue = false } = {}) {
  return {
    chunks: [],
    closed: false,
    failEnqueue,
    enqueue(chunk) {
      if (this.failEnqueue || this.closed) throw new Error("controller closed");
      this.chunks.push(new TextDecoder().decode(chunk));
    },
    close() {
      this.closed = true;
    },
  };
}

test("uses the real interval timer when the caller supplies no scheduler", () => {
  const scheduled = [];
  const cleared = [];
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (handler, ms) => {
    scheduled.push({ handler, ms });
    return { unref() {} };
  };
  globalThis.clearInterval = (handle) => cleared.push(handle);

  try {
    const controller = makeController();
    const handle = openSseStream({
      controller,
      request: new Request("http://localhost:30141/api/agent/session-1/events"),
      route: "/api/agent/[id]/events",
      sessionId: "session-1",
      connect: (send) => {
        send({ type: "connected" });
      },
    });

    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].ms, SSE_HEARTBEAT_MS);
    handle.cancel();
    assert.equal(cleared.length, 1);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test("returns a cancel handle when connect already failed to write", () => {
  const controller = makeController({ failEnqueue: true });
  let registered = 0;
  const handle = openSseStream({
    controller,
    request: new Request("http://localhost:30141/api/agent/session-1/events"),
    route: "/api/agent/[id]/events",
    connect: (send, registerCleanup) => {
      registerCleanup(() => {
        registered += 1;
      });
      send({ type: "connected" });
    },
    scheduleInterval: () => () => {},
  });

  handle.cancel();
  handle.cancel();
  flushLogs();

  assert.equal(registered, 1);
  assert.equal(controller.closed, false);
  const closes = readRecords().filter(
    (entry) => entry.message === "http.stream.close" && entry.reason === "controller_closed",
  );
  assert.equal(closes.length, 1);
});
