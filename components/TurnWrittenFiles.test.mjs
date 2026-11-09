import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { TurnWrittenFiles } = await jiti.import("./TurnWrittenFiles.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function render(props) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(TurnWrittenFiles, props)));
}

test("renders a button per file showing the basename and full path", () => {
  const html = render({
    files: [{ filePath: "/abs/out/report.html" }, { filePath: "/abs/out/data.json" }],
    onOpenFile() {},
  });
  assert.match(html, /<button/);
  assert.match(html, /report\.html/);
  assert.match(html, /data\.json/);
  assert.match(html, /title="\/abs\/out\/report\.html"/);
  assert.match(html, /title="\/abs\/out\/data\.json"/);
});

test("renders nothing when no files were written", () => {
  assert.equal(render({ files: [], onOpenFile() {} }), "");
});

test("long names truncate inside the chip instead of widening it", () => {
  const longName = `${"a".repeat(60)}.ts`;
  const html = render({ files: [{ filePath: `/abs/out/${longName}` }], onOpenFile() {} });
  // 名字容器允许收缩，超出部分用省略号；完整路径留在 title 里，
  // 读屏拿到的是 aria-label（完整文件名，因为本轮没有同名冲突）。
  assert.match(html, /text-overflow:ellipsis/);
  assert.match(html, /white-space:nowrap/);
  assert.match(html, /overflow:hidden/);
  assert.ok(html.includes(`title="/abs/out/${longName}"`), "full path must stay in title");
  assert.ok(html.includes(`aria-label="Open ${longName}"`), "assistive tech must get the full file name");
});

test("same-named files render distinct visible text and distinct labels", () => {
  const html = render({
    files: [{ filePath: "/abs/alpha/notes.md" }, { filePath: "/abs/beta/notes.md" }],
    onOpenFile() {},
  });
  // 只断言可见文本：title 属性里始终是完整路径，拿它匹配会让「只显示文件名」的
  // 旧实现也通过，这条断言就失去了意义。
  const visible = [...html.matchAll(/<span[^>]*>([^<]*)<\/span>/g)]
    .map((m) => m[1])
    .filter((text) => text.endsWith(".md"));
  assert.deepEqual(visible, ["alpha/notes.md", "beta/notes.md"]);
  const labels = [...html.matchAll(/aria-label="([^"]*notes\.md)"/g)].map((m) => m[1]);
  assert.equal(labels.length, 2, "both chips must carry an aria label");
  assert.notEqual(labels[0], labels[1], "screen-reader labels must differ");
});
