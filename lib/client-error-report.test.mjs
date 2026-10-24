import assert from "node:assert/strict";
import test from "node:test";

const {
  buildClientErrorReport,
  ClientErrorDeduplicator,
  CLIENT_ERROR_MESSAGE_LIMIT,
  CLIENT_ERROR_STACK_LIMIT,
  CLIENT_LOG_ENDPOINT,
  installClientErrorReporter,
  normalizeClientUrl,
  readSessionId,
  SlidingWindowLimiter,
  truncateClientField,
} = await import("./client-error-report.ts");

function fakeTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const current = listeners.get(type) ?? [];
      listeners.set(type, [...current, listener]);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== listener));
    },
    dispatch(type, event) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
    count(type) {
      return (listeners.get(type) ?? []).length;
    },
  };
}

function fakeFetch() {
  const calls = [];
  const fetch = async (input, init) => {
    calls.push({ input, init });
    return new Response(null, { status: 204 });
  };
  return { calls, fetch };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("builds a bounded report from an exception", () => {
  const error = new Error("boom");
  const report = buildClientErrorReport({
    kind: "error",
    error,
    url: "/chat?session=abc#bottom",
    sessionId: "abc",
    buildVersion: "1.2.3",
  });

  assert.deepEqual(Object.keys(report).sort(), [
    "buildVersion", "kind", "message", "sessionId", "stack", "url",
  ]);
  assert.equal(report.kind, "error");
  assert.equal(report.message, "boom");
  assert.match(report.stack, /^Error: boom/);
  assert.equal(report.url, "/chat");
  assert.equal(report.sessionId, "abc");
  assert.equal(report.buildVersion, "1.2.3");
});

test("truncates the message and stack and normalizes the url", () => {
  const report = buildClientErrorReport({
    kind: "error",
    error: new Error("m".repeat(5_000)),
    url: "https://user:pass@example.test:30141/chat?token=secret#frag",
  });

  assert.ok(report.message.length <= CLIENT_ERROR_MESSAGE_LIMIT + 40);
  assert.match(report.message, /… \[truncated \d+ chars\]$/);
  assert.ok(report.stack.length <= CLIENT_ERROR_STACK_LIMIT + 40);
  assert.match(report.stack, /… \[truncated \d+ chars\]$/);
  assert.equal(report.url, "/chat");
  assert.equal(JSON.stringify(report).includes("secret"), false);
  assert.equal(JSON.stringify(report).includes("user:pass"), false);
});

test("never serializes arbitrary rejection reasons", () => {
  const fromObject = buildClientErrorReport({
    kind: "unhandledrejection",
    error: { message: "prompt text", prompt: "do not log me" },
  });
  assert.equal(fromObject.message, "Unhandled promise rejection");
  assert.equal(fromObject.stack, undefined);
  assert.equal(JSON.stringify(fromObject).includes("prompt text"), false);

  const fromString = buildClientErrorReport({
    kind: "unhandledrejection",
    error: "plain rejection text",
  });
  assert.equal(fromString.message, "plain rejection text");

  const crossRealm = buildClientErrorReport({
    kind: "unhandledrejection",
    error: { [Symbol.toStringTag]: "Error", message: "foreign error", stack: "at frame" },
  });
  assert.equal(crossRealm.message, "foreign error");
  assert.equal(crossRealm.stack, "at frame");
});

test("falls back to a generic message when nothing usable is present", () => {
  assert.equal(
    buildClientErrorReport({ kind: "error" }).message,
    "Uncaught exception",
  );
  assert.equal(
    buildClientErrorReport({ kind: "unhandledrejection" }).message,
    "Unhandled promise rejection",
  );
});

test("normalizes urls and reads the session id", () => {
  assert.equal(normalizeClientUrl("/logs?token=x#top"), "/logs");
  assert.equal(normalizeClientUrl("https://host.test/a/b?x=1"), "/a/b");
  assert.equal(normalizeClientUrl(""), undefined);
  assert.equal(readSessionId("?session=abc-123&cwd=/tmp"), "abc-123");
  assert.equal(readSessionId("?cwd=/tmp"), undefined);
  assert.equal(readSessionId(""), undefined);
  assert.equal(truncateClientField("abcd", 2), "ab… [truncated 2 chars]");
});

test("reports one bounded payload per distinct browser failure", async () => {
  const target = fakeTarget();
  const { calls, fetch } = fakeFetch();
  const uninstall = installClientErrorReporter({
    target,
    fetch,
    location: { pathname: "/chat", search: "?session=sess-1" },
    buildVersion: "1.2.3",
  });

  const error = new Error("boom");
  target.dispatch("error", { message: "boom", error });
  await flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, CLIENT_LOG_ENDPOINT);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(calls[0].init.keepalive, true);

  const payload = JSON.parse(calls[0].init.body);
  assert.deepEqual(Object.keys(payload).sort(), [
    "buildVersion", "kind", "message", "sessionId", "stack", "url",
  ]);
  assert.equal(payload.kind, "error");
  assert.equal(payload.message, "boom");
  assert.equal(payload.url, "/chat");
  assert.equal(payload.sessionId, "sess-1");
  assert.equal(payload.buildVersion, "1.2.3");

  // The same event dispatched again must not double-report.
  target.dispatch("error", { message: "boom", error });
  await flush();
  assert.equal(calls.length, 1);

  target.dispatch("unhandledrejection", { reason: new Error("rejected") });
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[1].init.body).kind, "unhandledrejection");

  uninstall();
  assert.equal(target.count("error"), 0);
  target.dispatch("error", { message: "boom", error });
  await flush();
  assert.equal(calls.length, 2);
});

test("ignores resource load errors and keeps console.error untouched", async () => {
  const target = fakeTarget();
  const { calls, fetch } = fakeFetch();
  const original = console.error;
  installClientErrorReporter({
    target,
    fetch,
    location: { pathname: "/chat" },
    buildVersion: "test",
  });

  target.dispatch("error", { type: "error", target: { tagName: "IMG" } });
  await flush();

  assert.equal(calls.length, 0);
  assert.equal(console.error, original);
});

test("bounds browser-side traffic with a sliding limiter", async () => {
  const target = fakeTarget();
  const { calls, fetch } = fakeFetch();
  installClientErrorReporter({
    target,
    fetch,
    location: { pathname: "/chat" },
    buildVersion: "test",
    limiter: new SlidingWindowLimiter(2, 60_000),
    now: () => 1_000,
  });

  for (const message of ["one", "two", "three"]) {
    target.dispatch("error", { message, error: new Error(message) });
  }
  await flush();
  assert.equal(calls.length, 2);

  const limiter = new SlidingWindowLimiter(2, 1_000);
  assert.deepEqual(limiter.take("key", 0), { allowed: true, retryAfterMs: 0 });
  assert.deepEqual(limiter.take("key", 10), { allowed: true, retryAfterMs: 0 });
  const denied = limiter.take("key", 20);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterMs, 980);
  assert.equal(limiter.take("other", 20).allowed, true);
  assert.equal(limiter.take("key", 1_100).allowed, true);
});

test("deduplicates identical reports inside the window", () => {
  const dedupe = new ClientErrorDeduplicator(5_000, 4);
  const report = { kind: "error", message: "boom", stack: "Error: boom\n at a:1" };

  assert.equal(dedupe.shouldReport(report, 0), true);
  assert.equal(dedupe.shouldReport(report, 4_999), false);
  assert.equal(dedupe.shouldReport({ ...report, message: "other" }, 4_999), true);
  assert.equal(dedupe.shouldReport(report, 5_000), true);
});
