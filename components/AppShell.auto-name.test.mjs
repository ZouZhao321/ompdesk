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

test("自动命名不关闭顶栏面板，状态留在按钮上", () => {
  const autoNameSource = source.slice(
    source.indexOf("const handleAutoName = useCallback(async () => {"),
    source.indexOf("}, [autoNameStatus.kind, selectedSession?.id"),
  );
  assert.ok(autoNameSource.length > 0, "handleAutoName must exist");
  assert.doesNotMatch(autoNameSource, /setActiveTopPanel\(null\)/);
  assert.match(autoNameSource, /setAutoNameStatus\(\{ kind: "naming" \}\)/);
});

test("手机档会话面板显示生成中与失败原因", () => {
  const panelStart = source.indexOf("手机档顶栏不展示全量历史、自动命名与会话地图");
  assert.ok(panelStart >= 0, "手机档会话面板的动作区必须存在");
  const mobilePanelSource = source.slice(
    panelStart,
    source.indexOf('{translate("map.open")}', panelStart),
  );
  assert.ok(mobilePanelSource.length > 0, "手机档会话面板的动作区必须存在");
  assert.match(
    mobilePanelSource,
    /autoNameStatus\.kind === "naming" && \(\s*<svg className="animate-spin"/,
    "生成中必须在按钮上转圈，手机档看不到悬停提示",
  );
  assert.match(
    mobilePanelSource,
    /autoNameStatus\.kind === "error" && \([\s\S]*?\{autoNameStatus\.message\}/,
    "失败原因必须在面板里直接可见",
  );
});
