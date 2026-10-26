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
  const visibilityHandler = source.slice(
    source.indexOf("const onVisibilityChange = () => {"),
    source.indexOf('document.addEventListener("visibilitychange", onVisibilityChange)'),
  );
  assert.ok(visibilityHandler.length > 0, "onVisibilityChange must exist");
  assert.match(visibilityHandler, /if \(document\.visibilityState === "visible"\) \{[\s\S]*?void poll\(\);/);
  // 默认只轻量读取：只有失联过或隐藏期间确有运行在跑，才绕过缓存重扫。
  assert.match(visibilityHandler, /loadSessions\(false, mayHaveFinished\)/);
  assert.doesNotMatch(visibilityHandler, /loadSessions\(false, true\)/);
  assert.match(visibilityHandler, /serverOutageSinceSnapshotRef\.current/);
  assert.match(visibilityHandler, /previousActivitySnapshotRef\.current\.runningSessionIds\?\.length/);
});

test("remembers that the server went away while a session was running", () => {
  assert.match(source, /serverOutageSinceSnapshotRef\.current = true;/);
});

test("seeds the marker backlog only after the initial restore picked a session", () => {
  const seedEffect = source.slice(
    source.indexOf("// 首次加载时把浏览器的异常存量加入未读集合"),
    source.indexOf("useEffect(() => {\n    let stopped = false;"),
  );
  assert.match(seedEffect, /if \(!initialRestoreSettled\) return;\s*if \(allSessions\.length === 0/);
  assert.match(seedEffect, /\.filter\(\(id\) => id !== selectedSessionId\)/);
  // 恢复路径负责放行播种，播种因此排在它之后。
  assert.match(source, /setInitialRestoreSettled\(true\);\s*if \(target\) \{/);
});

test("settles the initial restore when the ready session list is empty", () => {
  const restoreEffect = source.slice(
    source.indexOf("// Auto-select cwd and restore session from URL on first load"),
    source.indexOf("const commitCustomPath"),
  );
  assert.ok(restoreEffect.length > 0, "初始恢复的 effect 必须存在");
  // 列表还在到达时为空只代表尚未加载，不能当作恢复失败。
  assert.match(restoreEffect, /if \(loading\) return;/);
  // 列表就绪且为空：先落定并通知父组件，再退出，否则播种、重启对账与运行集合
  // 持久化会一直等一次不会到来的恢复。
  const emptyStart = restoreEffect.indexOf("if (allSessions.length === 0) {");
  assert.ok(emptyStart >= 0, "空列表分支必须存在");
  const emptyBranch = restoreEffect.slice(
    emptyStart,
    restoreEffect.indexOf("\n    }", emptyStart),
  );
  assert.match(emptyBranch, /setInitialRestoreSettled\(true\);/);
  assert.match(emptyBranch, /onInitialRestoreDone\?\.\(\);/);
  assert.match(emptyBranch, /return;/);
});

test("skips the open session when reconciling runs lost across a restart", () => {
  assert.match(
    source,
    /addUnreadSessionIds\(lostAcrossRestart\.unreadIds\.filter\(\(id\) => id !== selectedSessionId\)\);/,
  );
});

test("waits for the initial restore before reconciling runs lost across a restart", () => {
  const reconcileStart = source.indexOf("服务失联或退出后页面看不到结束的那一刻");
  assert.ok(reconcileStart >= 0, "重启对账必须留在侧栏里");
  const reconcileSource = source.slice(
    reconcileStart,
    source.indexOf("savePersistedRunningSessionIds(runningSessionIds);", reconcileStart),
  );
  // 恢复中的会话还没成为选中会话，对账排在恢复之后才不会把它点亮。
  assert.match(reconcileSource, /if \(!activityPolled \|\| !initialRestoreSettled\) return;/);
  assert.match(reconcileSource, /lostAcrossRestart\.unreadIds\.filter\(\(id\) => id !== selectedSessionId\)/);
});

test("forces a full session re-read only when the finish produced unread results", () => {
  const finishedStart = source.indexOf("const finished = resolveFinishedRuns({");
  assert.ok(finishedStart >= 0, "结束归属计算必须留在侧栏里");
  const finishedSource = source.slice(
    finishedStart,
    source.indexOf("onBackgroundTaskDone", finishedStart),
  );
  assert.match(finishedSource, /if \(finished\.unreadIds\.length > 0 \|\| hasUnlistedRunningSession\) \{/);
  assert.doesNotMatch(finishedSource, /finished\.finishedIds\.length > 0/);
});

test("lights the refresh button only for cache-bypassing scans", () => {
  const loadSessionsSource = source.slice(
    source.indexOf("const loadSessions = useCallback"),
    source.indexOf("// Bumped whenever a session is archived/restored"),
  );
  assert.ok(loadSessionsSource.length > 0, "loadSessions must exist");
  assert.match(loadSessionsSource, /if \(force\) setSessionRefreshDone\(true\);/);
  assert.doesNotMatch(loadSessionsSource, /if \(!showLoading\) \{/);
});

test("clears the watched session's marker once it is visible again", () => {
  assert.match(
    source,
    /if \(\s*document\.visibilityState === "visible"\s*&& selectedSessionId\s*&& finished\.finishedIds\.includes\(selectedSessionId\)\s*\) \{\s*clearUnreadSessionIds\(\[selectedSessionId\]\);/,
  );
});
