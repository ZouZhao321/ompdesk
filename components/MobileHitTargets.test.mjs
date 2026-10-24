import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { MOBILE_HIT_TARGET_PX } = await jiti.import("../lib/mobile-layout.ts");
const chatInputSource = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const chatWindowSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("mobile hit target matches the 44px touch minimum", () => {
  assert.equal(MOBILE_HIT_TARGET_PX, 44);
});

test("composer controls raise their hit area on the mobile tier only", () => {
  // 附件按钮：移动档 44×44，桌面档保持 32×32。
  assert.match(
    chatInputSource,
    /width: isMobile \? MOBILE_HIT_TARGET_PX : 32,\s*height: isMobile \? MOBILE_HIT_TARGET_PX : 32,/,
  );
  // 模型选择器：移动档整行高 44。
  assert.match(
    chatInputSource,
    /padding: isMobile \? "8px 10px" : "8px 12px",\s*height: isMobile \? MOBILE_HIT_TARGET_PX : 32,/,
  );
  // 发送与停止：最小命中区 44×44。
  assert.match(
    chatInputSource,
    /padding: "7px 14px",\s*minWidth: isMobile \? MOBILE_HIT_TARGET_PX : undefined,\s*minHeight: isMobile \? MOBILE_HIT_TARGET_PX : undefined,/,
  );
  assert.match(
    chatInputSource,
    /padding: "8px 14px",\s*minWidth: isMobile \? MOBILE_HIT_TARGET_PX : undefined,\s*height: isMobile \? MOBILE_HIT_TARGET_PX : 32,/,
  );
  // 更多控件入口与其折叠按钮。
  assert.match(chatInputSource, /minWidth: MOBILE_HIT_TARGET_PX,\s*height: MOBILE_HIT_TARGET_PX,/);
  assert.match(chatInputSource, /width: MOBILE_HIT_TARGET_PX,\s*height: MOBILE_HIT_TARGET_PX,/);
  assert.equal(
    [...chatInputSource.matchAll(/minWidth: isMobile \? MOBILE_HIT_TARGET_PX : undefined,/g)].length,
    5,
  );
});

test("the collapsed more-controls panel stays the only mobile entry to the extra controls", () => {
  assert.match(chatInputSource, /isMobile && controlsMenuOpen &&/);
  assert.equal(
    [...chatInputSource.matchAll(/display: isMobile \? \(controlsMenuOpen \? "flex" : "none"\) : "flex",/g)].length,
    1,
  );
});

test("extension dialogs cap height against the app viewport and keep actions reachable", () => {
  // 应答框、计划审阅、普通请求框、扩展自定义面板各一处。
  assert.equal([...chatWindowSource.matchAll(/--app-viewport-height/g)].length, 4);
  assert.match(
    chatWindowSource,
    /maxHeight: isMobile\s*\?\s*"min\(100%, calc\(var\(--app-viewport-height, 100dvh\) - 24px\)\)"\s*:\s*"min\(780px, calc\(100dvh - 32px\)\)",/,
  );
  assert.match(
    chatWindowSource,
    /height: isMobile\s*\?\s*"min\(820px, calc\(var\(--app-viewport-height, 100dvh\) - 24px\)\)"\s*:\s*"min\(820px, calc\(100dvh - 32px\)\)",/,
  );
  assert.match(
    chatWindowSource,
    /maxHeight: isMobile \? "min\(100%, calc\(var\(--app-viewport-height, 100dvh\) - 24px\)\)" : undefined,/,
  );
  assert.match(
    chatWindowSource,
    /maxHeight: isMobile\s*\?\s*"min\(760px, calc\(var\(--app-viewport-height, 100dvh\) - 24px\)\)"\s*:\s*"min\(760px, calc\(100vh - 40px\)\)",/,
  );
  // 弹窗正文滚动、表头与动作行不参与收缩。
  assert.equal(
    [...chatWindowSource.matchAll(/flexShrink: isMobile \? 0 : undefined/g)].length,
    7,
  );
  assert.match(
    chatWindowSource,
    /maxHeight: isMobile \? "none" : "calc\(min\(760px, 100vh - 40px\) - 48px\)",\s*flex: isMobile \? "1 1 auto" : undefined,\s*minHeight: isMobile \? 0 : undefined,/,
  );
});

test("dialog buttons meet the mobile hit target", () => {
  // 应答框 3 个动作按钮 + 选项行 + 计划审阅 2 个 + 普通请求框 2 个 + 扩展面板关闭。
  assert.equal(
    [...chatWindowSource.matchAll(/minHeight: isMobile \? MOBILE_HIT_TARGET_PX/g)].length,
    11,
  );
  // 应答框 3 个、计划审阅 2 个、普通请求框 3 个、扩展面板关闭 1 个。
  assert.equal(
    [...chatWindowSource.matchAll(/minWidth: isMobile \? MOBILE_HIT_TARGET_PX : undefined/g)].length,
    9,
  );
  assert.match(
    chatWindowSource,
    /width: "100%",\s*minHeight: isMobile \? MOBILE_HIT_TARGET_PX : undefined,\s*padding: "9px 10px",/,
  );
});
