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
  const clearIndex = selectSessionSource.indexOf("clearUnreadSessionIds([session.id])");
  const noOpIndex = selectSessionSource.indexOf("if (!isRestore && selectedSession)");
  assert.ok(clearIndex >= 0, "选中会话时必须清掉未读标记");
  assert.ok(noOpIndex >= 0, "同会话短路分支必须存在");
  assert.ok(clearIndex < noOpIndex, "清除必须排在同会话短路之前");
});

test("keeps the marker when the workspace only auto-restores a session", () => {
  // 选中会话内只有一处清除，且被 !isRestore 挡住；恢复路径因此保留标记。
  assert.equal(
    [...selectSessionSource.matchAll(/clearUnreadSessionIds\(/g)].length,
    1,
    "选中会话内不应出现第二处清除",
  );
  assert.match(selectSessionSource, /if \(!isRestore\) clearUnreadSessionIds\(\[session\.id\]\);/);
  assert.match(sidebar, /onSelectSession\(target, true\)/);
});
