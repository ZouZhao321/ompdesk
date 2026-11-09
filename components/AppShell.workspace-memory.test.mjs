import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

function callbackBody(name, nextName) {
  const start = source.indexOf(`const ${name} = useCallback`);
  const end = source.indexOf(`const ${nextName} = useCallback`, start);
  assert.notEqual(start, -1, `${name} callback not found`);
  assert.notEqual(end, -1, `${nextName} callback not found after ${name}`);
  return source.slice(start, end);
}

test("explicit context changes invalidate a pending workspace restore", () => {
  const callbacks = [
    ["handleCwdChange", "handleSelectSession"],
    ["handleSelectSession", "handleNewSession"],
    ["handleNewSession", "hydrateSelectedSession"],
    ["handleSessionCreated", "handleAgentEnd"],
    ["handleSessionForked", "handleInitialRestoreDone"],
    ["handleSessionDeleted", "handleOpenFile"],
  ];

  for (const [name, nextName] of callbacks) {
    assert.match(callbackBody(name, nextName), /invalidateWorkspaceRestore\(\);/);
  }
});

test("all active-session transitions share one persistence effect", () => {
  assert.match(
    source,
    /useEffect\(\(\) => \{\s+if \(!selectedSession\) return;[\s\S]*?setLastOpenSession\(normalizeProjectKey\(projectKey\), selectedSession\.id\);\s+\}, \[selectedSession\]\);/,
  );
});

test("workspace restoration stays within the cross-project flow", () => {
  // ompdesk returns early on same-project moves (compared by normalized key)
  // before the restore call.
  assert.match(
    callbackBody("handleCwdChange", "handleSelectSession"),
    /if \(currentProject !== null && normalizeProjectKey\(currentProject\) === normalizeProjectKey\(newProject\)\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?restoreWorkspaceContext\(newProject\);/,
  );
  assert.match(
    callbackBody("handleCwdChange", "handleSelectSession"),
    /if \(currentProject !== null && normalizeProjectKey\(currentProject\) === normalizeProjectKey\(newProject\)\) \{[\s\S]*?setNewSessionCwd\(\(prev\) => \(prev === null \? prev : cwd\)\);/,
  );
});
