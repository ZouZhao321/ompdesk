import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const markerModule = await createJiti(import.meta.url).import("./session-marker.ts");
const { resolveSessionMarker, initialMarkerUnreadIds, STATIC_MARKER_APPEARANCE } = markerModule;
const { enLocale } = await createJiti(import.meta.url).import("./i18n/messages/en.ts");
const { zhCNLocale } = await createJiti(import.meta.url).import("./i18n/messages/zh-CN.ts");

const STATIC_STATUSES = ["complete", "interrupted", "aborted", "error", "pending"];

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

test("shows a static marker for each of the five lifecycle results", () => {
  for (const status of STATIC_STATUSES) {
    assert.deepEqual(resolveSessionMarker({ status, isUnread: true }), { kind: "static", status }, status);
  }
});

test("drops each static marker once the session is read", () => {
  for (const status of STATIC_STATUSES) {
    assert.equal(resolveSessionMarker({ status, isUnread: false }), null, status);
  }
});

test("keeps every static result behind the dynamic markers", () => {
  for (const status of STATIC_STATUSES) {
    assert.deepEqual(resolveSessionMarker({ status, isRunning: true, isUnread: true }), RUNNING, status);
    assert.deepEqual(resolveSessionMarker({ status, isWaiting: true, isUnread: true }), AWAITING, status);
  }
});

test("maps each static result to its theme color and accessibility label", () => {
  assert.deepEqual(STATIC_MARKER_APPEARANCE["complete"], {
    color: "var(--success)",
    labelKey: "sidebar.sessionComplete",
  });
  assert.deepEqual(STATIC_MARKER_APPEARANCE["interrupted"], {
    color: "var(--warning)",
    labelKey: "sidebar.sessionInterrupted",
  });
  assert.deepEqual(STATIC_MARKER_APPEARANCE["aborted"], {
    color: "var(--text-muted)",
    labelKey: "sidebar.sessionAborted",
  });
  assert.deepEqual(STATIC_MARKER_APPEARANCE["error"], {
    color: "var(--danger)",
    labelKey: "sidebar.sessionError",
  });
  assert.deepEqual(STATIC_MARKER_APPEARANCE["pending"], {
    color: "var(--accent)",
    labelKey: "sidebar.sessionPending",
  });
});

test("provides Chinese and English accessibility text for all five results", () => {
  for (const status of STATIC_STATUSES) {
    const { labelKey } = STATIC_MARKER_APPEARANCE[status];
    assert.ok(enLocale.messages[labelKey]?.trim(), `en ${labelKey}`);
    assert.ok(zhCNLocale.messages[labelKey]?.trim(), `zh-CN ${labelKey}`);
  }
});

test("shows no marker when the status could not be determined", () => {
  assert.equal(resolveSessionMarker({ status: "unknown", isUnread: true }), null);
  assert.equal(resolveSessionMarker({ isUnread: true }), null);
});

const session = (id, status, extra = {}) => ({ id, cwd: "/repo", status, ...extra });

test("seeds unread entries for the existing abnormal sessions", () => {
  const sessions = [
    session("interrupted", "interrupted"),
    session("aborted", "aborted"),
    session("error", "error"),
    session("pending", "pending"),
    session("complete", "complete"),
    session("unknown", "unknown"),
    session("missing", undefined),
  ];

  assert.deepEqual(
    initialMarkerUnreadIds(sessions, new Set(), new Set()),
    ["interrupted", "aborted", "error", "pending"],
  );
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

test("seeds nothing when every session completed normally or could not be determined", () => {
  assert.deepEqual(
    initialMarkerUnreadIds([session("a", "complete"), session("b", "unknown")], new Set(), new Set()),
    [],
  );
});
