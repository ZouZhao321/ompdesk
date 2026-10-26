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

test("自动命名按钮在桌面顶栏与手机档会话面板复用同一份渲染", () => {
  const panelStart = source.indexOf("手机档顶栏不展示全量历史、自动命名与会话地图");
  assert.ok(panelStart >= 0, "手机档会话面板的动作区必须存在");
  const mobilePanelSource = source.slice(
    panelStart,
    source.indexOf('{translate("map.open")}', panelStart),
  );
  assert.ok(mobilePanelSource.length > 0, "手机档会话面板的动作区必须存在");
  assert.match(
    mobilePanelSource,
    /<AutoNameAction[\s\S]*?variant="mobile-panel"/,
    "手机档入口必须复用共享渲染",
  );

  // 两处入口各自只剩一次调用，按钮本身只有一份实现。
  assert.equal(source.match(/<AutoNameAction/g)?.length, 2);
  const sharedSource = source.slice(
    source.indexOf("function AutoNameAction("),
    source.indexOf("export function AppShell()"),
  );
  assert.ok(sharedSource.length > 0, "共享渲染函数必须存在");
  // 手机档看不到悬停提示：生成中在按钮上转圈，失败原因直接写在面板里。
  assert.match(sharedSource, /\.\.\.MOBILE_SESSION_ACTION_STYLE/);
  assert.match(sharedSource, /status\.kind === "naming"/, "生成中必须有按钮内状态");
  assert.match(
    sharedSource,
    /!topBar && status\.kind === "error"[\s\S]*?\{status\.message\}/,
    "失败原因必须在面板里直接可见",
  );
  // 错误色收敛到一个常量。
  assert.match(sharedSource, /AUTO_NAME_ERROR_COLOR/);
  assert.equal(
    source.match(/#dc2626/g)?.length,
    2,
    "自动命名的错误色只能出现在常量里（另一处是工作区加载失败提示）",
  );
});
