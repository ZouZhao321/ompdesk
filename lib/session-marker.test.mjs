import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { resolveSessionMarker, initialMarkerUnreadIds } = await createJiti(import.meta.url)
  .import("./session-marker.ts");

const INTERRUPTED = { kind: "static", status: "interrupted" };
const RUNNING = { kind: "running" };
const AWAITING = { kind: "awaiting" };

test("marks an unread interrupted session with a static interrupted marker", () => {
  assert.deepEqual(resolveSessionMarker({ status: "interrupted", isUnread: true }), INTERRUPTED);
});

test("drops the marker once the interrupted session is read", () => {
  assert.equal(resolveSessionMarker({ status: "interrupted", isUnread: false }), null);
});

test("shows the running marker while the session is processing", () => {
  assert.deepEqual(resolveSessionMarker({ isRunning: true, isUnread: false }), RUNNING);
});

test("shows the awaiting marker while the session waits for the user", () => {
  assert.deepEqual(resolveSessionMarker({ isWaiting: true, isUnread: false }), AWAITING);
});

test("prefers the awaiting marker when the session is running and waiting at once", () => {
  assert.deepEqual(
    resolveSessionMarker({ status: "interrupted", isRunning: true, isWaiting: true, isUnread: true }),
    AWAITING,
  );
});

test("returns to the running marker once the form is answered", () => {
  assert.deepEqual(
    resolveSessionMarker({ status: "interrupted", isRunning: true, isWaiting: false, isUnread: true }),
    RUNNING,
  );
});

test("never overlaps a running session with a static marker", () => {
  assert.deepEqual(
    resolveSessionMarker({ status: "interrupted", isRunning: true, isUnread: true }),
    RUNNING,
  );
});

test("never overlaps a session waiting for the user with a static marker", () => {
  assert.deepEqual(
    resolveSessionMarker({ status: "interrupted", isWaiting: true, isUnread: true }),
    AWAITING,
  );
});

test("shows no static marker for the lifecycle results that belong to later work", () => {
  for (const status of ["complete", "aborted", "error", "pending"]) {
    assert.equal(resolveSessionMarker({ status, isUnread: true }), null, status);
  }
});

test("shows no marker when the status could not be determined", () => {
  assert.equal(resolveSessionMarker({ status: "unknown", isUnread: true }), null);
  assert.equal(resolveSessionMarker({ isUnread: true }), null);
});

const session = (id, status, extra = {}) => ({ id, cwd: "/repo", status, ...extra });

test("seeds unread entries for the existing interrupted sessions", () => {
  const sessions = [
    session("interrupted", "interrupted"),
    session("complete", "complete"),
    session("unknown", "unknown"),
    session("missing", undefined),
  ];

  assert.deepEqual(initialMarkerUnreadIds(sessions, new Set(), new Set()), ["interrupted"]);
});

test("does not seed sessions that are still running or waiting for the user", () => {
  const sessions = [
    session("running", "interrupted"),
    session("waiting", "interrupted"),
    session("idle", "interrupted"),
  ];

  const seeded = initialMarkerUnreadIds(sessions, new Set(["running"]), new Set(["waiting"]));

  assert.deepEqual(seeded, ["idle"]);
});

test("seeds nothing when no session is interrupted", () => {
  assert.deepEqual(
    initialMarkerUnreadIds([session("a", "complete"), session("b", "pending")], new Set(), new Set()),
    [],
  );
});
