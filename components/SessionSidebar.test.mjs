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
  assert.match(sessionItemSource, /!marker && isUnread && <UnreadSessionIndicator \/>/);
});

test("labels the inline waiting indicator without a count", () => {
  const waitingIndicatorSource = source.slice(
    source.indexOf("function WaitingSessionIndicator()"),
    source.indexOf("function UnreadSessionIndicator()"),
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
  assert.match(indicatorSource("function WaitingSessionIndicator()", "function UnreadSessionIndicator()"), /role="img"/);
  assert.match(indicatorSource("function UnreadSessionIndicator()", "function showProjectActivity("), /role="img"/);

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
const runActivityEffect = new Function(
  "previousActivitySnapshotRef", "activitySnapshot", "runningSessionIds",
  "selectedSessionId", "selectedRuntimeId", "allSessions", "setUnreadSessionIds",
  "loadSessions", "onBackgroundTaskDone",
  source.slice(activityEffectStart, activityEffectEnd),
);

const snapshot = (runningSessionIds, sessionIdsByRuntimeId = {}) => ({ runningSessionIds, sessionIdsByRuntimeId });
const activityCases = [
  {
    name: "does not report selected runtime completion when restart loses its relocated identity",
    previous: snapshot(["a"], { "runtime:selected": "a" }),
    current: snapshot([]),
    selectedSessionId: "b", selectedRuntimeId: "runtime:selected",
    expectedUnread: [],
  },
  {
    name: "still reports another runtime completing in the same restart snapshot",
    previous: snapshot(["a", "other"], { "runtime:selected": "a", "runtime:other": "other" }),
    current: snapshot([]),
    selectedSessionId: "b", selectedRuntimeId: "runtime:selected",
    expectedUnread: ["other"],
  },
  {
    name: "does not suppress background completion when both runtime IDs are absent",
    previous: snapshot(["a"]),
    current: snapshot([]),
    selectedSessionId: "b",
    expectedUnread: ["a"],
  },
  {
    name: "keeps ordinary selected transcript completion out of background notifications",
    previous: snapshot(["a"]),
    current: snapshot([]),
    selectedSessionId: "a",
    expectedUnread: [],
  },
  {
    name: "matches selected completion through the current runtime mapping",
    previous: snapshot(["a"], { "runtime:selected": "a" }),
    current: snapshot([], { "runtime:selected": "b" }),
    selectedSessionId: "a", selectedRuntimeId: "runtime:selected",
    expectedUnread: [],
  },
  {
    name: "does not complete a relocated runtime that is still running",
    previous: snapshot(["a"], { "runtime:other": "a" }),
    current: snapshot(["b"], { "runtime:other": "b" }),
    selectedSessionId: "selected", selectedRuntimeId: "runtime:selected",
    initialUnread: ["b"], expectedUnread: [],
  },
  {
    name: "marks the current transcript unread when a background runtime finishes",
    previous: snapshot(["a"], { "runtime:other": "a" }),
    current: snapshot([], { "runtime:other": "b" }),
    selectedSessionId: "selected", selectedRuntimeId: "runtime:selected",
    expectedUnread: ["b"],
  },
];

for (const scenario of activityCases) {
  test(scenario.name, () => {
    const previousRef = { current: scenario.previous };
    let unread = new Set(scenario.initialUnread ?? []);
    let completionCount = 0;
    const refreshes = [];
    runActivityEffect(
      previousRef, scenario.current, new Set(scenario.current.runningSessionIds),
      scenario.selectedSessionId, scenario.selectedRuntimeId,
      ["a", "b", "other", "selected"].map((id) => ({ id })),
      (update) => { unread = update(unread); },
      (...args) => { refreshes.push(args); },
      () => { completionCount += 1; },
    );
    assert.deepEqual([...unread], scenario.expectedUnread);
    const completed = scenario.expectedUnread.length > 0;
    assert.equal(completionCount, completed ? 1 : 0);
    assert.deepEqual(refreshes, completed ? [[false, true]] : []);
    assert.equal(previousRef.current, scenario.current);
  });
}

const archivedSectionSource = source.slice(
  source.indexOf("function ArchivedSessionsSection("),
  source.indexOf("function SessionTreeItem("),
);

test("keeps exactly one lifecycle marker slot on a session row", () => {
  assert.match(sessionItemSource, /const marker = resolveSessionMarker\(\{/);
  assert.equal((sessionItemSource.match(/<StaticSessionMarker\b/g) ?? []).length, 1);
  assert.equal((sessionItemSource.match(/<UnreadSessionIndicator \/>/g) ?? []).length, 1);
});

test("renders the static lifecycle marker as an animated-free labelled dot", () => {
  const staticMarkerSource = indicatorSource(
    "function StaticSessionMarker(",
    "function UnreadSessionIndicator()",
  );
  assert.match(staticMarkerSource, /role="img"/);
  assert.match(staticMarkerSource, /aria-label=\{t\("sidebar\.sessionInterrupted"\)\}/);
  assert.match(staticMarkerSource, /var\(--warning\)/);
  assert.doesNotMatch(staticMarkerSource, /<animate/);
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
