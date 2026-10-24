import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const sidebarSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

// 抽屉样式只写在最后一个移动档媒体查询里。
const MOBILE_QUERY = "@media (max-width: 768px), (pointer: coarse) and (max-height: 480px)";
const mobileStart = cssSource.lastIndexOf(MOBILE_QUERY);
const mobileBlock = cssSource.slice(mobileStart);

function mobileRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = mobileBlock.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `${selector} 未写入移动档媒体查询`);
  return match[1];
}

function assertOnlyMobile(selector) {
  const occurrences = cssSource.split(selector).length - 1;
  assert.equal(occurrences, 1, `${selector} 只应出现在移动档媒体查询中`);
  assert.ok(cssSource.indexOf(selector) > mobileStart, `${selector} 不应出现在移动档之外`);
}

function assertMinSize(declarations, property) {
  const values = [...declarations.matchAll(new RegExp(`${property}:\\s*(\\d+)px`, "g"))].map((m) => Number(m[1]));
  assert.ok(values.length > 0, `缺少 ${property}`);
  for (const value of values) assert.ok(value >= 44, `${property} 为 ${value}px，小于 44px`);
}

test("抽屉会话行在移动档至少 44px 高", () => {
  const row = mobileRule(".sidebar-session-row");
  assertMinSize(row, "min-height");
  assertOnlyMobile(".sidebar-session-row");
  // 正常会话行与归档会话行都带该类。
  assert.equal(sidebarSource.split('className="sidebar-session-row"').length - 1, 2);
});

test("项目行在移动档至少 44px 高", () => {
  const row = mobileRule(".sidebar-project-row");
  assertMinSize(row, "min-height");
  assertOnlyMobile(".sidebar-project-row");
  assert.match(sidebarSource, /className="sidebar-project-row"/);
});

test("行内项目图标的命中区不小于 44×44 且图标尺寸不变", () => {
  const button = mobileRule(".sidebar-project-icon-button");
  assertMinSize(button, "min-width");
  assertMinSize(button, "min-height");
  assertOnlyMobile(".sidebar-project-icon-button");
  // 折叠、新建、项目操作三个图标共用命中区类。
  assert.equal(sidebarSource.split('className="sidebar-project-icon-button"').length - 1, 1);
  assert.equal(
    sidebarSource.split('className="sidebar-project-icon-button sidebar-project-icon-reveal"').length - 1,
    2,
  );
  // 命中区由 min-width/min-height 扩大，svg 自身尺寸不变。
  assert.doesNotMatch(button, /\bsvg\s*\{/);
});

test("触屏下项目操作图标常驻可点", () => {
  const reveal = mobileRule(".sidebar-project-icon-reveal");
  assert.match(reveal, /opacity:\s*1\s*!important/);
  assert.match(reveal, /pointer-events:\s*auto\s*!important/);
  assertOnlyMobile(".sidebar-project-icon-reveal");
});

test("展开更多按钮在移动档至少 44×44", () => {
  const showMore = mobileRule(".sidebar-show-more");
  assertMinSize(showMore, "min-width");
  assertMinSize(showMore, "min-height");
  assertOnlyMobile(".sidebar-show-more");
  assert.match(sidebarSource, /className="sidebar-show-more"/);
});

test("点选会话后移动抽屉收起", () => {
  assert.match(sidebarSource, /onClick=\{confirmDelete \|\| renaming \? undefined : onClick\}/);
  assert.match(sidebarSource, /onClick=\{\(\) => onSelectSession\(node\.session\)\}/);
  assert.match(
    appShellSource,
    /const handleSelectSession = useCallback\([\s\S]*?if \(isMobile && !isRestore\) setSidebarOpen\(false\);/,
  );
});

test("桌面档不套用抽屉点按尺寸", () => {
  const desktopStart = cssSource.indexOf("@media (min-width: 769px)");
  const desktopEnd = cssSource.indexOf("/* Compact desktop file panel");
  const desktopBlock = cssSource.slice(desktopStart, desktopEnd);
  for (const selector of [".sidebar-session-row", ".sidebar-project-row", ".sidebar-project-icon-button", ".sidebar-show-more"]) {
    assert.ok(!desktopBlock.includes(selector), `${selector} 不应影响桌面侧栏`);
  }
});
