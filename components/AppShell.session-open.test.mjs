import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appShell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

const selectSessionSource = appShell.slice(
  appShell.indexOf("const handleSelectSession = useCallback"),
  appShell.indexOf("const handleNewSession = useCallback"),
);

test("clears the unread marker when the command palette opens a session", () => {
  const openByIdSource = appShell.slice(
    appShell.indexOf("const handleOpenSessionById"),
    appShell.indexOf("const handleSessionCreated"),
  );
  assert.match(openByIdSource, /handleSelectSession\(session\);/);
  assert.match(selectSessionSource, /if \(!isRestore\) clearUnreadSessionIds\(\[session\.id\]\);/);
});

test("clears before the same-session no-op so re-opening a row still counts as read", () => {
  assert.ok(selectSessionSource.indexOf("clearUnreadSessionIds([session.id])") >= 0);
  assert.ok(
    selectSessionSource.indexOf("clearUnreadSessionIds([session.id])") <
      selectSessionSource.indexOf("if (!isRestore && selectedSession)"),
  );
});

test("keeps the marker when the workspace only auto-restores a session", () => {
  assert.equal((appShell.match(/clearUnreadSessionIds\(/g) ?? []).length, 1);
  assert.match(sidebar, /onSelectSession\(target, true\)/);
});
