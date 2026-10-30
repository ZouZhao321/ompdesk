import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./TranscriptRail.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

/** 取一条 CSS 规则的声明块；规则不存在时返回 null。 */
function declarations(selector) {
  const start = styles.indexOf(selector);
  if (start === -1) return null;
  const open = styles.indexOf("{", start);
  const close = styles.indexOf("}", open);
  if (open === -1 || close === -1) return null;
  return styles.slice(open + 1, close);
}

test("opens the prompt tip on keyboard focus, not only on hover", () => {
  assert.match(source, /onMouseEnter=\{\(event\) => showTip\(event\.currentTarget, dot\.prompt\)\}/);
  assert.match(source, /onFocus=\{\(event\) => showTip\(event\.currentTarget, dot\.prompt\)\}/);
  assert.match(source, /onMouseLeave=\{hideTip\}/);
  assert.match(source, /onBlur=\{hideTip\}/);
  // 聚焦态与悬停态共用一套圆点样式，键盘用户看到的提示与鼠标一致。
  assert.match(
    styles,
    /\.transcript-rail-dot:hover \.transcript-rail-dot-mark,\s*\.transcript-rail-dot:focus-visible \.transcript-rail-dot-mark \{[^}]*width: 12px;[^}]*background: var\(--accent-hover\);/,
  );
  assert.match(declarations(".transcript-rail-dot:focus-visible"), /outline: 2px solid var\(--accent\);/);
});

test("re-anchors the tip when the dot column scrolls under the focus ring", () => {
  // Tab 到容器外的圆点时浏览器会把圆点滚进来；这次滚动不该把提示收掉。
  assert.match(source, /const insideRail = dotsRef\.current\?\.contains\(event\.target as Node\) \?\? false;/);
  assert.match(source, /const stillFocused = anchor\.element\.ownerDocument\.activeElement === anchor\.element;/);
  assert.match(source, /if \(insideRail \|\| stillFocused\) \{\s*reposition\(anchor\);/);
  assert.match(source, /setTip\(\(previous\) => \(previous && previous\.top === next\.top \? previous : next\)\)/);
  // 其余滚动（鼠标悬停时转写向前向后）仍让提示失去锚点。
  assert.match(source, /hideTip\(\);\s*\};\s*window\.addEventListener\("scroll", onScroll, true\);/);
  assert.match(source, /window\.removeEventListener\("scroll", onScroll, true\)/);
});

test("marks the current dot and nothing else", () => {
  assert.match(source, /aria-current=\{index === currentDotIndex \? "true" : undefined\}/);
  assert.equal(source.match(/aria-current/g)?.length, 1);
  assert.match(source, /aria-label=\{t\("chat\.jumpToPrompt", \{ index: index \+ 1 \}\)\}/);
});

test("disables the step buttons at both ends", () => {
  assert.match(source, /aria-label=\{t\("chat\.previousPrompt"\)\}/);
  assert.match(source, /aria-label=\{t\("chat\.nextPrompt"\)\}/);
  assert.match(source, /disabled=\{previousItemIndex === null\}/);
  assert.match(source, /disabled=\{nextItemIndex === null\}/);
  // 原生 disabled 已经挡掉点击；这里的守卫让事件处理器也自己挡住。
  assert.match(source, /if \(previousItemIndex !== null\) onJump\(previousItemIndex\);/);
  assert.match(source, /if \(nextItemIndex !== null\) onJump\(nextItemIndex\);/);
});

test("keeps a disabled step visually out of reach", () => {
  const disabled = declarations(".transcript-rail-step:disabled");
  assert.ok(disabled, "missing .transcript-rail-step:disabled");
  assert.match(disabled, /opacity: 0\.35;/);
  assert.match(disabled, /background: transparent;/);
  assert.match(disabled, /color: var\(--text-dim\);/);
  assert.match(disabled, /cursor: default;/);
  // 悬停高亮排除禁用项，禁用的一端不会亮成强调色。
  assert.match(styles, /\.transcript-rail-step:hover:not\(:disabled\)/);
});

test("keeps the rail out of the tab order while it is hidden", () => {
  // 容器查询与移动档都用 display: none 收起，隐藏时元素不可聚焦。
  assert.match(styles, /@container chat-transcript \(max-width: 899px\) \{\s*\.transcript-rail \{\s*display: none;/);
  // 移动档与桌面档是同一个选择器、都在未分层样式里，优先级相同，靠后声明即可覆盖。
  const baseRule = styles.indexOf(".transcript-rail {");
  const mobileMedia = styles.lastIndexOf("@media (max-width: 768px), (pointer: coarse) and (max-width: 1023px)");
  assert.ok(baseRule > 0 && mobileMedia > baseRule, "the mobile rule must be declared after the desktop rule");
  assert.match(styles.slice(mobileMedia), /\.transcript-rail \{\s*display: none;\s*\}/);
  // 只有一轮提问时干脆不渲染，圆点与按钮都不存在。
  assert.match(chatWindow, /shouldShowTranscriptRail\(railDots\.length\) && \(\s*<TranscriptRail/);
  assert.doesNotMatch(source, /tabIndex=/);
});

test("puts the rail ahead of the transcript in the tab order", () => {
  const rail = chatWindow.indexOf("<TranscriptRail");
  const list = chatWindow.indexOf("<TranscriptListRefContext.Provider value={transcriptListRef}>");
  assert.ok(rail > 0, "ChatWindow does not render <TranscriptRail>");
  assert.ok(list > rail, "the rail must precede the transcript so Tab reaches it first");
  // 上一条按钮在最前，圆点居中，下一条按钮在最后。
  const up = source.indexOf('className="transcript-rail-step"');
  const dots = source.indexOf('className="transcript-rail-dots"');
  const down = source.lastIndexOf('className="transcript-rail-step"');
  assert.ok(up > 0 && dots > up && down > dots);
});
