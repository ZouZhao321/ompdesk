import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const markerModule = await createJiti(import.meta.url).import("./session-marker.ts");
const {
  resolveSessionMarker,
  initialMarkerUnreadIds,
  shouldMarkSessionUnread,
  resolveFinishedRuns,
  STATIC_MARKER_APPEARANCE,
  STATIC_MARKER_STATUSES,
} = markerModule;
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
    resolveSessionMarker({
      status: "interrupted",
      isRunning: true,
      isWaiting: true,
      isUnread: true,
    }),
    AWAITING,
  );
});

test("returns to the running marker once the form is answered", () => {
  assert.deepEqual(
    resolveSessionMarker({
      status: "interrupted",
      isRunning: true,
      isWaiting: false,
      isUnread: true,
    }),
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
    assert.deepEqual(
      resolveSessionMarker({ status, isUnread: true }),
      { kind: "static", status },
      status,
    );
  }
});

test("drops each static marker once the session is read", () => {
  for (const status of STATIC_STATUSES) {
    assert.equal(resolveSessionMarker({ status, isUnread: false }), null, status);
  }
});

test("keeps every static result behind the dynamic markers", () => {
  for (const status of STATIC_STATUSES) {
    assert.deepEqual(
      resolveSessionMarker({ status, isRunning: true, isUnread: true }),
      RUNNING,
      status,
    );
    assert.deepEqual(
      resolveSessionMarker({ status, isWaiting: true, isUnread: true }),
      AWAITING,
      status,
    );
  }
});

test("maps each static result to its theme color and accessibility labels", () => {
  assert.deepEqual(STATIC_MARKER_APPEARANCE["complete"], {
    color: "var(--success)",
    labelKey: "sidebar.sessionComplete",
    countLabelKey: "sidebar.sessionCompleteWithCount",
  });
  assert.deepEqual(STATIC_MARKER_APPEARANCE["interrupted"], {
    color: "var(--warning)",
    labelKey: "sidebar.sessionInterrupted",
    countLabelKey: "sidebar.sessionInterruptedWithCount",
  });
  assert.deepEqual(STATIC_MARKER_APPEARANCE["aborted"], {
    color: "var(--text-muted)",
    labelKey: "sidebar.sessionAborted",
    countLabelKey: "sidebar.sessionAbortedWithCount",
  });
  assert.deepEqual(STATIC_MARKER_APPEARANCE["error"], {
    color: "var(--danger)",
    labelKey: "sidebar.sessionError",
    countLabelKey: "sidebar.sessionErrorWithCount",
  });
  assert.deepEqual(STATIC_MARKER_APPEARANCE["pending"], {
    color: "var(--accent)",
    labelKey: "sidebar.sessionPending",
    countLabelKey: "sidebar.sessionPendingWithCount",
  });
});

test("orders the five static results complete, interrupted, aborted, error, pending", () => {
  assert.deepEqual([...STATIC_MARKER_STATUSES], STATIC_STATUSES);
  assert.deepEqual(Object.keys(STATIC_MARKER_APPEARANCE), STATIC_STATUSES);
});

test("provides Chinese and English accessibility text for all five results", () => {
  for (const status of STATIC_STATUSES) {
    const { labelKey, countLabelKey } = STATIC_MARKER_APPEARANCE[status];
    assert.ok(enLocale.messages[labelKey]?.trim(), `en ${labelKey}`);
    assert.ok(zhCNLocale.messages[labelKey]?.trim(), `zh-CN ${labelKey}`);
    assert.match(enLocale.messages[countLabelKey] ?? "", /\{count\}/, `en ${countLabelKey}`);
    assert.match(zhCNLocale.messages[countLabelKey] ?? "", /\{count\}/, `zh-CN ${countLabelKey}`);
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

  assert.deepEqual(initialMarkerUnreadIds(sessions, new Set(), new Set()), [
    "interrupted",
    "aborted",
    "error",
    "pending",
  ]);
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
    initialMarkerUnreadIds(
      [session("a", "complete"), session("b", "unknown")],
      new Set(),
      new Set(),
    ),
    [],
  );
});

test("does not mark a session the user is watching while the page stays visible", () => {
  assert.equal(shouldMarkSessionUnread({ isSelected: true, isPageVisible: true }), false);
});

test("marks a watched session that finished while the page was in the background", () => {
  assert.equal(shouldMarkSessionUnread({ isSelected: true, isPageVisible: false }), true);
});

test("marks every other session that finishes", () => {
  assert.equal(shouldMarkSessionUnread({ isSelected: false, isPageVisible: true }), true);
  assert.equal(shouldMarkSessionUnread({ isSelected: false, isPageVisible: false }), true);
});

test("marks an unobserved end even when the user is watching it", () => {
  assert.equal(
    shouldMarkSessionUnread({ isSelected: true, isPageVisible: true, isEndUnobserved: true }),
    true,
  );
});

const finishedRuns = (input) =>
  resolveFinishedRuns({
    previousRunningSessionIds: [],
    runningSessionIds: new Set(),
    isPageVisible: true,
    ...input,
  });

test("keeps the watched session read when it finishes in the foreground", () => {
  const result = finishedRuns({
    previousRunningSessionIds: ["watched"],
    selectedSessionId: "watched",
  });

  assert.deepEqual(result.finishedIds, ["watched"]);
  assert.deepEqual(result.unreadIds, []);
  assert.deepEqual(result.backgroundIds, []);
});

test("marks the watched session once it finishes in the background", () => {
  const result = finishedRuns({
    previousRunningSessionIds: ["watched"],
    selectedSessionId: "watched",
    isPageVisible: false,
  });

  assert.deepEqual(result.finishedIds, ["watched"]);
  assert.deepEqual(result.unreadIds, ["watched"]);
  assert.deepEqual(result.backgroundIds, []);
});

test("marks another session finishing while the user watches a different one", () => {
  const result = finishedRuns({
    previousRunningSessionIds: ["other"],
    selectedSessionId: "watched",
  });

  assert.deepEqual(result.unreadIds, ["other"]);
  assert.deepEqual(result.backgroundIds, ["other"]);
});

test("attributes an unobserved end to the unread marker even for the watched session", () => {
  const result = finishedRuns({
    previousRunningSessionIds: ["waiting"],
    selectedSessionId: "waiting",
    isEndUnobserved: true,
  });

  assert.deepEqual(result.unreadIds, ["waiting"]);
  assert.deepEqual(result.backgroundIds, []);
});

test("reports a run under the session id it moved to", () => {
  const result = finishedRuns({
    previousRunningSessionIds: ["old"],
    previousSessionIdsByRuntimeId: { "runtime:a": "old" },
    sessionIdsByRuntimeId: { "runtime:a": "fresh" },
    selectedSessionId: "watched",
  });

  assert.deepEqual(result.finishedIds, ["fresh"]);
  assert.deepEqual(result.unreadIds, ["fresh"]);
});

test("keeps a relocated run that is still running out of the finished set", () => {
  const result = finishedRuns({
    previousRunningSessionIds: ["old"],
    previousSessionIdsByRuntimeId: { "runtime:a": "old" },
    sessionIdsByRuntimeId: { "runtime:a": "fresh" },
    runningSessionIds: new Set(["fresh"]),
  });

  assert.deepEqual(result.finishedIds, []);
});

test("still reports a run whose relocation was lost when the page was hidden", () => {
  const result = finishedRuns({
    previousRunningSessionIds: ["old"],
    previousSessionIdsByRuntimeId: { "runtime:selected": "old" },
    selectedSessionId: "other",
    selectedRuntimeId: "runtime:selected",
    isPageVisible: false,
  });

  assert.deepEqual(result.finishedIds, ["old"]);
  assert.deepEqual(result.unreadIds, ["old"]);
});

test("marks the watched run when it ends in the background even though its runtime is selected", () => {
  const result = finishedRuns({
    previousRunningSessionIds: ["watched"],
    previousSessionIdsByRuntimeId: { "runtime:selected": "watched" },
    sessionIdsByRuntimeId: { "runtime:selected": "watched" },
    selectedSessionId: "watched",
    selectedRuntimeId: "runtime:selected",
    isPageVisible: false,
  });

  assert.deepEqual(result.finishedIds, ["watched"]);
  assert.deepEqual(result.unreadIds, ["watched"]);
  assert.deepEqual(result.backgroundIds, []);
});

test("attributes an unobserved end to the watched run through its runtime mapping", () => {
  const result = finishedRuns({
    previousRunningSessionIds: ["old"],
    previousSessionIdsByRuntimeId: { "runtime:selected": "old" },
    sessionIdsByRuntimeId: { "runtime:selected": "fresh" },
    selectedSessionId: "old",
    selectedRuntimeId: "runtime:selected",
    isEndUnobserved: true,
  });

  assert.deepEqual(result.finishedIds, ["fresh"]);
  assert.deepEqual(result.unreadIds, ["fresh"]);
});

test("marks runs that disappeared across a restart even when the page stayed visible", () => {
  const result = finishedRuns({
    previousRunningSessionIds: ["kept", "gone"],
    runningSessionIds: new Set(["kept"]),
    selectedSessionId: "gone",
    isEndUnobserved: true,
  });

  assert.deepEqual(result.unreadIds, ["gone"]);
});

test("reports one finished entry when two runtimes move to the same session id", () => {
  const result = finishedRuns({
    previousRunningSessionIds: ["old1", "old2"],
    previousSessionIdsByRuntimeId: { "runtime:a": "old1", "runtime:b": "old2" },
    sessionIdsByRuntimeId: { "runtime:a": "merged", "runtime:b": "merged" },
  });

  assert.deepEqual(result.finishedIds, ["merged"]);
});

test("keeps the selection when a merged run arrives after an unselected one", () => {
  const result = finishedRuns({
    previousRunningSessionIds: ["unmapped", "selected"],
    previousSessionIdsByRuntimeId: {
      "runtime:unmapped": "unmapped",
      "runtime:selected": "selected",
    },
    // 未映射的运行换算到已选中的会话上，重复项才是属于选中的那次运行。
    sessionIdsByRuntimeId: { "runtime:unmapped": "selected" },
    selectedRuntimeId: "runtime:selected",
  });

  assert.deepEqual(result.finishedIds, ["selected"]);
  assert.deepEqual(result.unreadIds, []);
  assert.deepEqual(result.backgroundIds, []);
});

test("ignores a status outside the marker union", () => {
  // 接口与会话文件都可能送来联合类型之外的新状态：没有外观就不产生标记。
  assert.equal(resolveSessionMarker({ status: "suspended", isUnread: true }), null);

  const sessions = [session("future", "suspended"), session("error", "error")];
  assert.deepEqual(initialMarkerUnreadIds(sessions, new Set(), new Set()), ["error"]);
});
