import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

test("only Shift+click bypasses session deletion confirmation", () => {
  assert.match(
    sessionItemSource,
    /const handleDeleteClick[\s\S]*?if \(e\.shiftKey\) \{\s*void performDelete\(\);\s*\} else \{\s*setConfirmDelete\(true\);/,
  );
});

test("does not register row-level session deletion shortcuts", () => {
  assert.doesNotMatch(sessionItemSource, /const handleKeyDown/);
  assert.doesNotMatch(sessionItemSource, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(sessionItemSource, /tabIndex=\{0\}/);
});

test("polls running sessions only while the tab is visible", () => {
  assert.doesNotMatch(source, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(source, /fetch\("\/api\/agent\/running"/);
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
});

test("keeps subagents out of the left session sidebar", () => {
  assert.doesNotMatch(source, /SubagentRail|SubagentPanel|subagents/);
});

test("includes project activity counts in accessible labels", () => {
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.agentRunning"\)\} \(\$\{activity\.running\}\)`\}/,
  );
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.newSessionActivity"\)\} \(\$\{activity\.unread\}\)`\}/,
  );
});

test("renders one marker slot driven by the resolved marker kind", () => {
  assert.equal((sessionItemSource.match(/marker\?\.kind === "awaiting"/g) ?? []).length, 1);
  assert.equal((sessionItemSource.match(/marker\?\.kind === "running"/g) ?? []).length, 1);
  assert.equal((sessionItemSource.match(/marker\?\.kind === "static"/g) ?? []).length, 1);
  assert.match(sessionItemSource, /marker\?\.kind === "static" && <StaticSessionMarker status=\{marker\.status\} \/>/);
  assert.doesNotMatch(sessionItemSource, /UnreadSessionIndicator/);
});

test("labels the inline waiting indicator without a count", () => {
  const waitingIndicatorSource = indicatorSource(
    "function WaitingSessionIndicator()",
    "function StaticSessionMarker(",
  );
  assert.match(waitingIndicatorSource, /title=\{t\("sidebar\.agentWaitingForInput"\)\}/);
  assert.match(waitingIndicatorSource, /aria-label=\{t\("sidebar\.agentWaitingForInput"\)\}/);
});

test("interpolates the project waiting badge label", () => {
  assert.match(
    source,
    /aria-label=\{t\("sidebar\.agentWaitingForInputWithCount", \{ count: activity\.waiting \}\)\}/,
  );
  assert.doesNotMatch(source, /aria-label=\{`\$\{t\("sidebar\.agentWaitingForInput"\)\}/);
});

test("confirms removal of a workspace with running or waiting sessions", () => {
  assert.match(
    source,
    /t\("sidebar\.removeProjectBusy", \{ count: removeProjectConfirm\.count \}\)/,
  );
  assert.doesNotMatch(source, /sidebar\.removeProjectRunning/);
});

const indicatorSource = (startMarker, nextMarker) =>
  source.slice(source.indexOf(startMarker), source.indexOf(nextMarker));

test("marks activity indicators as images for screen readers", () => {
  assert.match(indicatorSource("function RunningSessionIndicator()", "function WaitingSessionIndicator()"), /role="img"/);
  assert.match(indicatorSource("function WaitingSessionIndicator()", "function StaticSessionMarker("), /role="img"/);
  assert.match(indicatorSource("function StaticSessionMarker(", "function showProjectActivity("), /role="img"/);

  const projectBadges = indicatorSource("function showProjectActivity(", "function SessionItem(");
  assert.equal((projectBadges.match(/role="img"/g) ?? []).length, 3);
});

test("spins an accent gap ring while the session is processing", () => {
  const running = indicatorSource("function RunningSessionIndicator()", "function WaitingSessionIndicator()");
  assert.match(running, /var\(--accent\)/);
  assert.match(running, /<animateTransform[\s\S]*?type="rotate"/);
  assert.match(running, /<path[\s\S]*?stroke="currentColor"/);
  assert.doesNotMatch(running, /<circle/);
});

test("breathes a complete yellow ring without spinning while the session waits for the user", () => {
  const waiting = indicatorSource("function WaitingSessionIndicator()", "function StaticSessionMarker(");
  assert.match(waiting, /var\(--warning\)/);
  assert.match(waiting, /<circle[\s\S]*?stroke="currentColor"/);
  assert.doesNotMatch(waiting, /fill="currentColor"/);
  assert.match(waiting, /<animate /);
  assert.doesNotMatch(waiting, /animateTransform/);
  assert.doesNotMatch(waiting, /type="rotate"/);
});

test("does not persist an unchanged fallback title ending in whitespace", () => {
  assert.match(
    sessionItemSource,
    /const name = renameValue\.trim\(\);[\s\S]*?if \(renameValue === title \|\| name === \(session\.name \?\? ""\)\) return;/,
  );
});
test("offers the downstream context-menu hook only on a normal session row", () => {
  assert.match(sessionItemSource, /const handleContextMenu[\s\S]*?dispatchSessionRowContextMenu\(\{/);
  assert.match(
    sessionItemSource,
    /onContextMenu=\{confirmDelete \|\| renaming \? undefined : handleContextMenu\}/,
  );
});
test("manual and lifecycle refreshes bypass the server session-list cache", () => {
  assert.match(source, /force \? "\/api\/sessions\?force=1" : "\/api\/sessions"/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /loadSessions\(isFirst, !isFirst\)/);
  assert.match(source, /onClick=\{\(\) => loadSessions\(false, true\)\}/);
  assert.match(source, /loadSessions\(false, true\);[\s\S]*?onBackgroundTaskDone/);
});

test("does not expose disk-backed actions for transient sessions", () => {
  assert.match(sessionItemSource, /if \(session\.transient\) return;/);
});

// Execute the actual activity effect with state/notification doubles, so these
// cases cover unread markers and completion callbacks without copying its logic.
const activityEffectStart = source.indexOf("    const previousSnapshot = previousActivitySnapshotRef.current;");
const activityEffectEnd = source.indexOf("\n  }, [activitySnapshot,", activityEffectStart);
assert.ok(activityEffectStart >= 0 && activityEffectEnd > activityEffectStart);
const { resolveFinishedRuns, resolveSessionMarker } = await createJiti(import.meta.url).import(
  "../lib/session-marker.ts",
);
const runActivityEffect = new Function(
  "previousActivitySnapshotRef", "activitySnapshot", "runningSessionIds",
  "selectedSessionId", "selectedRuntimeId", "allSessions", "setUnreadSessionIds",
  "loadSessions", "onBackgroundTaskDone",
  "pageVisibilitySinceSnapshotRef", "serverOutageSinceSnapshotRef", "resolveFinishedRuns",
  "document",
  source.slice(activityEffectStart, activityEffectEnd),
);

const snapshot = (runningSessionIds, sessionIdsByRuntimeId = {}) => ({ runningSessionIds, sessionIdsByRuntimeId });
const activityCases = [
  {
    name: "does not report selected runtime completion when restart loses its relocated identity",
    previous: snapshot(["a"], { "runtime:selected": "a" }),
    current: snapshot([]),
    selectedSessionId: "b", selectedRuntimeId: "runtime:selected",
    expectedUnread: [], expectedRefresh: false, expectedCompletion: false,
  },
  {
    name: "still reports another runtime completing in the same restart snapshot",
    previous: snapshot(["a", "other"], { "runtime:selected": "a", "runtime:other": "other" }),
    current: snapshot([]),
    selectedSessionId: "b", selectedRuntimeId: "runtime:selected",
    expectedUnread: ["other"], expectedRefresh: true, expectedCompletion: true,
  },
  {
    name: "does not suppress background completion when both runtime IDs are absent",
    previous: snapshot(["a"]),
    current: snapshot([]),
    selectedSessionId: "b",
    expectedUnread: ["a"], expectedRefresh: true, expectedCompletion: true,
  },
  {
    name: "keeps ordinary selected transcript completion out of background notifications",
    previous: snapshot(["a"]),
    current: snapshot([]),
    selectedSessionId: "a",
    expectedUnread: [], expectedRefresh: true, expectedCompletion: false,
  },
  {
    name: "matches selected completion through the current runtime mapping",
    previous: snapshot(["a"], { "runtime:selected": "a" }),
    current: snapshot([], { "runtime:selected": "b" }),
    selectedSessionId: "a", selectedRuntimeId: "runtime:selected",
    expectedUnread: [], expectedRefresh: false, expectedCompletion: false,
  },
  {
    name: "does not complete a relocated runtime that is still running",
    previous: snapshot(["a"], { "runtime:other": "a" }),
    current: snapshot(["b"], { "runtime:other": "b" }),
    selectedSessionId: "selected", selectedRuntimeId: "runtime:selected",
    initialUnread: ["b"], expectedUnread: [], expectedRefresh: false, expectedCompletion: false,
  },
  {
    name: "marks the current transcript unread when a background runtime finishes",
    previous: snapshot(["a"], { "runtime:other": "a" }),
    current: snapshot([], { "runtime:other": "b" }),
    selectedSessionId: "selected", selectedRuntimeId: "runtime:selected",
    expectedUnread: ["b"], expectedRefresh: true, expectedCompletion: true,
  },
  {
    name: "marks the watched session when it finishes while the page was in the background",
    previous: snapshot(["watched"]),
    current: snapshot([]),
    selectedSessionId: "watched",
    pageVisible: false,
    expectedUnread: ["watched"], expectedRefresh: true, expectedCompletion: false,
  },
  {
    name: "marks the watched session when the run ended while the server was gone",
    previous: snapshot(["waiting"]),
    current: snapshot([]),
    selectedSessionId: "waiting",
    serverOutage: true,
    expectedUnread: ["waiting"], expectedRefresh: true, expectedCompletion: false,
  },
  {
    name: "clears the previous marker when the session starts running again",
    previous: snapshot([]),
    current: snapshot(["rerun"]),
    selectedSessionId: "selected",
    initialUnread: ["rerun"],
    expectedUnread: [], expectedRefresh: false, expectedCompletion: false,
  },
];

function runActivity(scenario) {
  const previousRef = { current: scenario.previous };
  const pageVisibilityRef = { current: scenario.pageVisible === false ? "hidden" : "visible" };
  const serverOutageRef = { current: scenario.serverOutage === true };
  const documentDouble = { visibilityState: pageVisibilityRef.current };
  let unread = new Set(scenario.initialUnread ?? []);
  let completionCount = 0;
  const refreshes = [];
  runActivityEffect(
    previousRef, scenario.current, new Set(scenario.current.runningSessionIds),
    scenario.selectedSessionId, scenario.selectedRuntimeId,
    ["a", "b", "other", "selected", "watched", "waiting", "rerun"].map((id) => ({ id })),
    (update) => { unread = update(unread); },
    (...args) => { refreshes.push(args); },
    () => { completionCount += 1; },
    pageVisibilityRef, serverOutageRef, resolveFinishedRuns,
    documentDouble,
  );
  return { previousRef, unread, refreshes, completionCount, pageVisibilityRef, serverOutageRef };
}

for (const scenario of activityCases) {
  test(scenario.name, () => {
    const { previousRef, unread, refreshes, completionCount, pageVisibilityRef, serverOutageRef } =
      runActivity(scenario);
    assert.deepEqual([...unread], scenario.expectedUnread);
    assert.deepEqual(refreshes, scenario.expectedRefresh ? [[false, true]] : []);
    assert.equal(completionCount, scenario.expectedCompletion ? 1 : 0);
    assert.equal(previousRef.current, scenario.current);
    assert.equal(pageVisibilityRef.current, scenario.pageVisible === false ? "hidden" : "visible");
    assert.equal(serverOutageRef.current, false);
  });
}

test("keeps the attribution window open when only the session list refreshes", () => {
  const current = snapshot([]);
  const previousRef = { current: snapshot(["watched"]) };
  const pageVisibilityRef = { current: "hidden" };
  const serverOutageRef = { current: true };
  let unread = new Set();
  const runEffect = () => runActivityEffect(
    previousRef, current, new Set(),
    "watched", undefined, [],
    (update) => { unread = update(unread); },
    () => {}, () => {},
    pageVisibilityRef, serverOutageRef, resolveFinishedRuns,
    { visibilityState: "visible" },
  );

  runEffect();
  assert.deepEqual([...unread], ["watched"]);
  assert.equal(pageVisibilityRef.current, "visible");
  assert.equal(serverOutageRef.current, false);

  // 快照没变时页面再次隐藏、服务再次失联；无关重跑不能提前关掉窗口。
  pageVisibilityRef.current = "hidden";
  serverOutageRef.current = true;
  runEffect();

  assert.equal(pageVisibilityRef.current, "hidden");
  assert.equal(serverOutageRef.current, true);
  assert.deepEqual([...unread], ["watched"]);
});

const archivedSectionSource = source.slice(
  source.indexOf("function ArchivedSessionsSection("),
  source.indexOf("function SessionTreeItem("),
);

test("keeps exactly one lifecycle marker slot on a session row", () => {
  assert.match(sessionItemSource, /const marker = resolveSessionMarker\(\{/);
  assert.equal((sessionItemSource.match(/<StaticSessionMarker\b/g) ?? []).length, 1);
  assert.doesNotMatch(sessionItemSource, /UnreadSessionIndicator|#0891b2/);
});

test("renders the static lifecycle marker as an animated-free labelled dot", () => {
  const staticMarkerSource = indicatorSource(
    "function StaticSessionMarker(",
    "function showProjectActivity(",
  );
  assert.match(staticMarkerSource, /function StaticSessionMarker\(\{ status \}: \{ status: StaticMarkerStatus \}\)/);
  assert.match(staticMarkerSource, /STATIC_MARKER_APPEARANCE\[status\]/);
  assert.match(staticMarkerSource, /role="img"/);
  assert.match(staticMarkerSource, /title=\{t\(labelKey\)\}/);
  assert.match(staticMarkerSource, /aria-label=\{t\(labelKey\)\}/);
  assert.match(staticMarkerSource, /<circle cx="7" cy="7" r="4" fill="currentColor" \/>/);
  assert.doesNotMatch(staticMarkerSource, /<animate|animateTransform|@keyframes|animation:/);
});

// 静态标记只在用户点开会话时熄灭；自动恢复打开的会话不算点开。
const markReadStart = source.indexOf(
  "    setUnreadSessionIds((prev) => {",
  source.indexOf("const markSessionRead"),
);
const markReadEnd = source.indexOf("\n  }, []);", markReadStart);
assert.ok(markReadStart >= 0 && markReadEnd > markReadStart);
const runMarkSessionRead = new Function(
  "sessionId", "setUnreadSessionIds",
  source.slice(markReadStart, markReadEnd),
);

test("drops the marker of any static result when the user opens its session", () => {
  for (const status of ["complete", "interrupted", "aborted", "error", "pending"]) {
    let unread = new Set(["opened"]);
    runMarkSessionRead("opened", (update) => { unread = update(unread); });
    assert.deepEqual([...unread], [], status);
    assert.equal(resolveSessionMarker({ status, isUnread: unread.has("opened") }), null, status);
  }
});

test("keeps the marker when the app only restores the session instead of opening it", () => {
  assert.match(source, /const handleSelectSessionFromList[\s\S]*?markSessionRead\(s\.id\)/);
  assert.doesNotMatch(source, /if \(!selectedSessionId\) return;\s*setUnreadSessionIds/);
});

test("keeps lifecycle markers out of the archived section", () => {
  assert.ok(archivedSectionSource.length > 0);
  assert.doesNotMatch(archivedSectionSource, /SessionMarker|UnreadSessionIndicator|resolveSessionMarker/);
});

// Execute the real first-load seeding effect with storage/state doubles, so the
// once-per-browser guarantee is locked down instead of copied into the test.
const seedEffectStart = source.indexOf(
  "    if (allSessions.length === 0 || !shouldSeedInitialMarkerUnread()) return;",
);
const seedEffectEnd = source.indexOf(
  "\n  }, [allSessions, runningSessionIds, waitingSessionIds, selectedSessionId]);",
  seedEffectStart,
);
assert.ok(seedEffectStart >= 0 && seedEffectEnd > seedEffectStart);
const { initialMarkerUnreadIds } = await createJiti(import.meta.url).import(
  "../lib/session-marker.ts",
);
const runSeedEffect = new Function(
  "allSessions", "runningSessionIds", "waitingSessionIds", "selectedSessionId", "setUnreadSessionIds",
  "shouldSeedInitialMarkerUnread", "markInitialMarkerUnreadSeeded", "initialMarkerUnreadIds",
  source.slice(seedEffectStart, seedEffectEnd),
);

function runSeed({ sessions, seeded = false, running = [], waiting = [], selected = null, unread = [] }) {
  let unreadIds = new Set(unread);
  const state = { seeded };
  runSeedEffect(
    sessions,
    new Set(running),
    new Set(waiting),
    selected,
    (update) => { unreadIds = update(unreadIds); },
    () => !state.seeded,
    () => { state.seeded = true; },
    initialMarkerUnreadIds,
  );
  return { unread: [...unreadIds], seeded: state.seeded };
}

test("seeds interrupted sessions into the unread set on first load", () => {
  const result = runSeed({
    sessions: [
      { id: "interrupted", status: "interrupted" },
      { id: "complete", status: "complete" },
      { id: "unread-complete", status: "complete" },
    ],
    unread: ["unread-complete"],
  });

  assert.deepEqual(result.unread.sort(), ["interrupted", "unread-complete"]);
  assert.equal(result.seeded, true);
});

test("does not re-seed a browser that already went through first load", () => {
  const result = runSeed({
    sessions: [{ id: "interrupted", status: "interrupted" }],
    seeded: true,
    unread: [],
  });

  assert.deepEqual(result.unread, []);
  assert.equal(result.seeded, true);
});

test("skips sessions that are still running when seeding", () => {
  const result = runSeed({
    sessions: [
      { id: "running", status: "interrupted" },
      { id: "read", status: "interrupted" },
    ],
    running: ["running"],
  });

  assert.deepEqual(result.unread, ["read"]);
});

test("does not seed the session the user already has open", () => {
  const result = runSeed({
    sessions: [
      { id: "open", status: "interrupted" },
      { id: "other", status: "interrupted" },
    ],
    selected: "open",
  });

  assert.deepEqual(result.unread, ["other"]);
});

// 进程退出不是可观察的完成：加载后把上次页面看到的运行集合与首轮轮询对账。
const reconcileStart = source.indexOf("    if (!activityPolled) return;");
const reconcileEnd = source.indexOf("\n  }, [activityPolled, runningSessionIds]);", reconcileStart);
assert.ok(reconcileStart >= 0 && reconcileEnd > reconcileStart);
const runReconcileEffect = new Function(
  "activityPolled", "runningSessionIds", "setUnreadSessionIds",
  "startupRunningIdsRef", "processExitReconciledRef",
  "loadPersistedRunningSessionIds", "savePersistedRunningSessionIds",
  source.slice(reconcileStart, reconcileEnd),
);

function createReconcileRun({ persisted = [], unread = [] } = {}) {
  const startupRef = { current: null };
  const reconciledRef = { current: false };
  const saved = [];
  const loads = [];
  let unreadIds = new Set(unread);
  const run = (running, polled = true) => runReconcileEffect(
    polled, new Set(running), (update) => { unreadIds = update(unreadIds); },
    startupRef, reconciledRef,
    () => { loads.push([...persisted]); return new Set(persisted); },
    (ids) => { saved.push([...ids]); },
  );
  return { run, saved, loads, startupRef, reconciledRef, unread: () => [...unreadIds] };
}

test("marks the session that disappeared while the page was not looking", () => {
  const reconcile = createReconcileRun({ persisted: ["waiting", "kept"] });
  reconcile.run(["kept"]);

  assert.deepEqual(reconcile.unread(), ["waiting"]);
  assert.deepEqual(reconcile.saved, [["kept"]]);
  assert.equal(reconcile.reconciledRef.current, true);
});

test("does not attribute a process exit before the first running snapshot arrives", () => {
  const reconcile = createReconcileRun({ persisted: ["waiting"] });
  reconcile.run([], false);

  assert.deepEqual(reconcile.unread(), []);
  assert.deepEqual(reconcile.saved, []);
  assert.equal(reconcile.loads.length, 0);
});

test("remembers the running set without re-attributing the same exit", () => {
  const reconcile = createReconcileRun({ persisted: ["waiting"] });
  reconcile.run([]);
  reconcile.run([]);

  assert.deepEqual(reconcile.unread(), ["waiting"]);
  assert.deepEqual(reconcile.saved, [[], []]);
  assert.equal(reconcile.loads.length, 1);
});

test("attributes only the first snapshot to the previous page load", () => {
  const reconcile = createReconcileRun({ persisted: ["first"] });
  reconcile.run([]);
  reconcile.run(["second"]);

  assert.deepEqual(reconcile.unread(), ["first"]);
  assert.deepEqual(reconcile.saved, [[], ["second"]]);
});

test("reconciles markers and running state when the page becomes visible again", () => {
  assert.match(
    source,
    /if \(document\.visibilityState === "visible"\) \{[\s\S]*?void poll\(\);\s*loadSessions\(false, true\);/,
  );
});

test("remembers that the server went away while a session was running", () => {
  assert.match(source, /serverOutageSinceSnapshotRef\.current = true;/);
});
