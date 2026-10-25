import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));
const indicatorSource = (startMarker, nextMarker) =>
  source.slice(source.indexOf(startMarker), source.indexOf(nextMarker));
const archivedSectionSource = source.slice(
  source.indexOf("function ArchivedSessionsSection("),
  source.indexOf("function SessionTreeItem("),
);

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

test("renders exactly one lifecycle marker slot on a session row", () => {
  assert.match(sessionItemSource, /const marker = resolveSessionMarker\(\{/);
  assert.equal((sessionItemSource.match(/marker\?\.kind === "awaiting"/g) ?? []).length, 1);
  assert.equal((sessionItemSource.match(/marker\?\.kind === "running"/g) ?? []).length, 1);
  assert.equal((sessionItemSource.match(/marker\?\.kind === "static"/g) ?? []).length, 1);
  assert.match(sessionItemSource, /marker\?\.kind === "static" && <StaticSessionMarker status=\{marker\.status\} \/>/);
  assert.equal((sessionItemSource.match(/<StaticSessionMarker\b/g) ?? []).length, 1);
  assert.doesNotMatch(sessionItemSource, /UnreadSessionIndicator|#0891b2/);
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

test("leaves marking a clicked session read to the shared open path", () => {
  assert.match(
    source,
    /const handleSelectSessionFromList = useCallback\(\(s: SessionInfo\) => \{\s*if \(s\.cwd\) setSelectedCwd\(s\.cwd\);\s*onSelectSession\(s\);/,
  );
  assert.match(source, /onClick=\{\(\) => onSelectSession\(s\)\}/);
  assert.doesNotMatch(source, /setUnreadSessionIds/);
});

test("keeps lifecycle markers out of the archived section", () => {
  assert.ok(archivedSectionSource.length > 0);
  assert.doesNotMatch(archivedSectionSource, /SessionMarker|UnreadSessionIndicator|resolveSessionMarker/);
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
