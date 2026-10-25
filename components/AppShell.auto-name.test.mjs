import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("压缩后的会话仍可根据持久化消息数生成标题", () => {
  assert.match(
    source,
    /\(sessionStats\?\.userMessages \?\? 0\) > 0 \|\| selectedSession\.messageCount > 0/,
  );
});

test("尚未落盘的会话不会触发依赖 JSONL 的自动命名", () => {
  assert.match(
    source,
    /const disabled = !selectedSession \|\| selectedSession\.transient \|\| !hasMessages/,
  );
});

test("会话落盘后会用服务端记录清除临时状态", () => {
  assert.match(source, /\{ \.\.\.prev, \.\.\.full, transient: full\.transient \?\? false \}/);
  assert.match(source, /if \(targetSession\) hydrateSelectedSession\(targetSession\.id\)/);
});

test("手机档自动命名不关闭会话面板，状态留在按钮上", () => {
  const autoNameSource = source.slice(
    source.indexOf("const handleAutoName = useCallback(async () => {"),
    source.indexOf("}, [autoNameStatus.kind, selectedSession?.id"),
  );
  assert.ok(autoNameSource.length > 0, "handleAutoName must exist");
  assert.doesNotMatch(autoNameSource, /setActiveTopPanel\(null\)/);
  assert.match(autoNameSource, /setAutoNameStatus\(\{ kind: "naming" \}\)/);
});
