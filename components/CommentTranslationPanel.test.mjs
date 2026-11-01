import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { CommentTranslationPanel } = await jiti.import("./CommentTranslationPanel.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const { MOBILE_HIT_TARGET_PX } = await jiti.import("../lib/mobile-layout.ts");

const panelSource = await readFile(new URL("./CommentTranslationPanel.tsx", import.meta.url), "utf8");

/** 取包含锚点的片段，用来断言某个控件附近写了移动档尺寸。 */
function sliceAround(anchor, before = 400, after = 400) {
  const index = panelSource.indexOf(anchor);
  assert.ok(index >= 0, `CommentTranslationPanel.tsx must keep ${anchor}`);
  return panelSource.slice(Math.max(0, index - before), index + after);
}

function render(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      { initialLocale: "en" },
      React.createElement(CommentTranslationPanel, { active: true, ...props }),
    ),
  );
}

test("asks for a project directory before listing anything", () => {
  assert.match(render({ cwd: undefined }), /No project directory selected/);
});

test("generation stays disabled while nothing is checked", () => {
  const html = render({ cwd: "/project" });
  assert.match(html, /Select all on page/);
  assert.match(html, /0 selected/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Generate \(0\)<\/button>/);
});

test("mobile controls take their hit area from the shared constant", () => {
  assert.equal(MOBILE_HIT_TARGET_PX, 44);
  assert.match(panelSource, /const hitTarget = isMobile \? MOBILE_HIT_TARGET_PX : undefined;/);
  // 勾选：页面级、文件级与词条级三处都走同一个命中区尺寸；文件级与词条级
  // 把输入包进 label，输入本身保持原尺寸。
  assert.equal(
    panelSource.match(/\.\.\.checkboxHitBoxStyle, minWidth: hitTarget, minHeight: hitTarget/g)?.length,
    2,
    "file-level and entry-level checkboxes must sit inside a hit-area label",
  );
  assert.match(sliceAround('t("comments.selectAll")', 600, 100), /minHeight: hitTarget/);
  // 编辑：已有译文的按钮与空译文的占位按钮都是整行 44px 高。
  assert.match(panelSource, /style=\{\{ \.\.\.translationButtonStyle, minHeight: hitTarget \}\}/);
  assert.match(sliceAround('t("comments.addTranslation")'), /minHeight: hitTarget/);
  // 生成：按钮与编辑框同样按命中区取值。
  assert.match(sliceAround('t("comments.generateSelected"', 600, 100), /minHeight: hitTarget/);
  assert.match(sliceAround("<textarea", 100, 1_600), /minHeight: hitTarget \?\? 60/);
});

test("mobile columns stay side by side and shrink instead of overlapping", () => {
  assert.match(panelSource, /const columnStyle = \{\s*minWidth: 0,\s*\} as const;/);
  // 词条行是唯一同时包两栏的网格：两栏各套一层 columnStyle，长文本只在栏内换行。
  assert.equal(panelSource.match(/<div style=\{columnStyle\}>/g)?.length, 2);
  assert.match(panelSource, /whiteSpace: "pre-wrap"/);
  assert.match(panelSource, /overflowWrap: "anywhere"/);
});

test("desktop controls keep their native sizes", () => {
  // 服务端快照属于桌面档：内联的命中区尺寸不出现。
  assert.doesNotMatch(render({ cwd: "/project" }), /min-width:\s*44px|min-height:\s*44px/);
});
