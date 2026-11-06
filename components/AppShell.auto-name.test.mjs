import assert from "node:assert/strict";
import test from "node:test";
import { readSource } from "../test-support/source-text";

const source = await readSource(new URL("./AppShell.tsx", import.meta.url));

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
  assert.equal(source.match(/<AutoNameAction/g)?.length, 2, "自动命名按钮只允许两处入口调用");
  const sharedStart = source.indexOf("function AutoNameAction(");
  assert.ok(sharedStart >= 0, "共享渲染函数必须存在");
  const sharedEnd = source.indexOf("export function AppShell()", sharedStart);
  assert.ok(sharedEnd > sharedStart, "共享渲染函数必须结束在 AppShell 之前");
  const sharedSource = source.slice(sharedStart, sharedEnd);
  // 手机档看不到悬停提示：生成中在按钮上转圈，失败原因直接写在面板里。
  assert.match(sharedSource, /\.\.\.MOBILE_SESSION_ACTION_STYLE/);
  assert.match(sharedSource, /status\.kind === "naming"/, "生成中必须有按钮内状态");
  assert.match(
    sharedSource,
    /!topBar && status\.kind === "error"[\s\S]*?\{status\.message\}/,
    "失败原因必须在面板里直接可见",
  );
  // 错误色收敛到一个主题变量：常量本身取 --danger，渲染处只引用常量。
  assert.match(source, /const AUTO_NAME_ERROR_COLOR = "var\(--danger\)";/);
  assert.equal(
    sharedSource.match(/AUTO_NAME_ERROR_COLOR/g)?.length,
    3,
    "错误色必须由常量提供：按钮配色一处、悬停配色一处、面板文字一处",
  );
  assert.doesNotMatch(sharedSource, /#[0-9a-fA-F]{3,8}\b/, "共享渲染里不应再出现具体色值");
});
