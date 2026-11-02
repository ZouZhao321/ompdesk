import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./TranscriptRail.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

/** 取一条 CSS 规则的声明块；规则不存在时返回 null。 */
function declarations(selector) {
  // 按行首找规则本身：注释里提到同一个选择器时不会截到注释后面的那条规则上。
  const start = styles.search(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m"));
  if (start === -1) return null;
  const open = styles.indexOf("{", start);
  const close = styles.indexOf("}", open);
  if (open === -1 || close === -1) return null;
  return styles.slice(open + 1, close);
}

/** 读一条自定义属性的像素值；缺失时让用例直接失败。 */
function customPixel(block, name) {
  const match = new RegExp(`--${name}:\\s*([\\d.]+)px;`).exec(block);
  assert.ok(match, `missing --${name}`);
  return Number(match[1]);
}

test("opens the prompt tip on keyboard focus, not only on hover", () => {
  assert.match(source, /onMouseEnter=\{\(event\) => showTip\(event\.currentTarget, dot\.prompt\)\}/);
  assert.match(source, /onFocus=\{\(event\) => showTip\(event\.currentTarget, dot\.prompt\)\}/);
  assert.match(source, /onMouseLeave=\{hideTip\}/);
  assert.match(source, /onBlur=\{hideTip\}/);
  // 聚焦态与悬停态共用一套圆点样式，键盘用户看到的提示与鼠标一致。
  assert.match(
    styles,
    /\.transcript-rail-dot:hover \.transcript-rail-dot-mark,\s*\.transcript-rail-dot:focus-visible \.transcript-rail-dot-mark \{[^}]*width: min\(12px, calc\(var\(--rail-dot-mark, 6px\) \* 2\)\);[^}]*background: var\(--accent-hover\);/,
  );
  assert.match(declarations(".transcript-rail-dot:focus-visible"), /outline: 2px solid var\(--accent\);/);
});

test("follows layout changes while the tip is showing", () => {
  // 缩放、面板拖拽、字体加载与圆点增减都不发滚动事件：竖条与圆点列的尺寸一变，
  // 锚点的纵向位置就变了。提示可见期间观察这两处，回调里重新对准。
  assert.match(
    source,
    /const observer = new ResizeObserver\(\(\) => \{\s*if \(anchorIsVisible\(\)\) positionTip\(\);\s*\}\);\s*if \(railRef\.current\) observer\.observe\(railRef\.current\);\s*if \(dotsRef\.current\) observer\.observe\(dotsRef\.current\);/,
  );
  assert.match(source, /observer\.disconnect\(\);/);
  // 圆点数组换了：锚点可能已经不在这份列表里，还在就按新位置重算，立不住就收起。
  assert.match(source, /if \(anchorIsVisible\(\)\) positionTip\(\);\s*return \(\) => \{/);
  // 每次圆点变化都重新挂上观察，提示期间的布局变化不会被漏掉。
  assert.match(source, /\}, \[tipVisible, dots, positionTip, hideTip\]\);/);
});

test("repositions the tip without listening to transcript scrolls", () => {
  // 转写区滚动搬不动圆点：提示位置只在竖条与圆点列尺寸变化、圆点数组变化时重算。
  // 不挂 window 滚动监听，流式跟随期间不会每个数据块都在滚动帧里多读一次布局。
  assert.doesNotMatch(source, /window\.addEventListener\("scroll"/);
  assert.match(
    source,
    /const observer = new ResizeObserver\(\(\) => \{\s*if \(anchorIsVisible\(\)\) positionTip\(\);\s*\}\);/,
  );
  // 锚点只在圆点被卸载或跳转条被收起时失效。
  assert.match(source, /if \(!anchor \|\| !isTipAnchorVisible\(anchor\.element, dotsRef\.current\)\) \{/);
  assert.match(source, /if \(!element\.isConnected\) return false;/);
  assert.match(source, /if \(rect\.width === 0 \|\| rect\.height === 0\) return false;/);
  assert.match(source, /return rect\.bottom > columnRect\.top && rect\.top < columnRect\.bottom;/);
  // 位置直接写 DOM，不进状态。
  assert.match(source, /element\.style\.top = `/);
  assert.doesNotMatch(source, /setTip\(/);
  // 收起只发生在失去锚点的分支里。
  assert.match(source, /\) \{\s*hideTip\(\);\s*return false;\s*\}/);
});

/** 跳转条几何：车道、缝隙与最小留白只写在 CSS 与这里，版心常量从 lib 读。 */
const LANE_PX = 36;
const GAP_PX = 6;
/** 跳转条右边缘的最小留白：转写区隐藏滚动条，这里就是普通间距，不为滚动条让位。 */
const MARGIN_PX = 4;

test("derives the rail geometry from the region constants", async () => {
  const { RAIL_COLUMN_PADDING_PX, RAIL_COLUMN_WIDTH_PX } = await import("../lib/transcript-rail.ts");
  const insetPx = RAIL_COLUMN_WIDTH_PX / 2 + RAIL_COLUMN_PADDING_PX + GAP_PX;
  const minRegionPx = 2 * (insetPx + LANE_PX + MARGIN_PX);
  const laneQueryMaxPx = minRegionPx - 1;
  const region = declarations(".chat-transcript-region");
  assert.ok(region, "missing .chat-transcript-region");
  // 车道与跳转条绝对定位，定位祖先写在转写区自己的规则里：行盒不再靠 Tailwind 的
  // relative 兜底，那个类被删掉时跳转条也不会静默改挂到整列上。
  assert.match(region, /position: relative;/);
  assert.doesNotMatch(chatWindow, /chat-transcript-region relative/);
  // 同步来源写在容器上：版心与内边距来自 ChatWindow 的行盒常量，车道宽来自 CSS。
  assert.match(region, new RegExp(`--chat-column-width: ${RAIL_COLUMN_WIDTH_PX}px;`));
  assert.match(region, new RegExp(`--chat-column-padding: ${RAIL_COLUMN_PADDING_PX}px;`));
  assert.match(region, new RegExp(`--transcript-rail-lane: ${LANE_PX}px;`));
  assert.equal(customPixel(region, "transcript-rail-gap"), GAP_PX);
  assert.equal(customPixel(region, "transcript-rail-margin"), MARGIN_PX);
  assert.doesNotMatch(region, /--chat-scrollbar-width/);
  // 转写区隐藏滚动条，与既有观感一致：跳转条不需要为滚动条留白，滚动条也不再定宽。
  // 隐藏只写在 .chat-session-scroll 一处，组件 className 不再重复挂 scrollbar-width
  // 工具类——两处来源会互相覆盖，改一处就漏一处。
  const scroller = declarations(".chat-session-scroll");
  assert.ok(scroller, "missing .chat-session-scroll");
  assert.match(scroller, /scrollbar-width: none;/);
  assert.doesNotMatch(scroller, /scrollbar-gutter/);
  assert.doesNotMatch(chatWindow, /\[scrollbar-width:(?:none|thin)\]/);
  // 隐藏态下 ::-webkit-scrollbar 只剩旧 Chromium 的兜底隐藏，没有宽度声明。
  const webkitScrollbar = declarations(".chat-session-scroll::-webkit-scrollbar");
  assert.ok(webkitScrollbar, "missing .chat-session-scroll::-webkit-scrollbar");
  assert.doesNotMatch(webkitScrollbar, /width:/);
  // 左缘偏移与最小宽度都由这几个常量算出，不再出现手抄的派生像素值。
  assert.match(
    region,
    /--transcript-rail-inset: calc\(\s*var\(--chat-column-width\) \/ 2 \+ var\(--chat-column-padding\) \+ var\(--transcript-rail-gap\)\s*\);/,
  );
  assert.match(
    region,
    /--transcript-rail-min-region: calc\(\s*2 \* \(var\(--transcript-rail-inset\) \+ var\(--transcript-rail-lane\) \+ var\(--transcript-rail-margin\)\)\s*\);/,
  );
  // 阈值把内边距与缝隙一起算进去：版心一半 + 内边距 + 缝隙 = 432，最小宽度 944。
  const inset = customPixel(region, "chat-column-width") / 2
    + customPixel(region, "chat-column-padding")
    + customPixel(region, "transcript-rail-gap");
  assert.equal(inset, insetPx);
  assert.equal(inset, 432);
  const minRegion = 2 * (
    inset + customPixel(region, "transcript-rail-lane") + customPixel(region, "transcript-rail-margin")
  );
  assert.equal(minRegion, minRegionPx);
  assert.equal(minRegion, 944);
  // 车道容器铺满转写区，只承载隐藏判定；容器查询写不了 calc，阈值照最小宽度减一。
  const lane = declarations(".transcript-rail-lane");
  assert.ok(lane, "missing .transcript-rail-lane");
  assert.match(lane, /container: transcript-rail-lane \/ inline-size;/);
  assert.doesNotMatch(lane, /width:/);
  assert.match(styles, new RegExp(`@container transcript-rail-lane \\(max-width: ${laneQueryMaxPx}px\\)`));
  assert.equal(laneQueryMaxPx, 943);
  const rail = declarations(".transcript-rail {");
  assert.ok(rail, "missing .transcript-rail");
  assert.match(
    rail,
    /right: max\(\s*var\(--transcript-rail-margin\),\s*calc\(50% - var\(--transcript-rail-inset\) - var\(--transcript-rail-lane\)\)\s*\);/,
  );
  const dot = declarations(".transcript-rail-dot {");
  assert.match(dot, /width: var\(--transcript-rail-lane\);/);
  assert.doesNotMatch(styles, /calc\(50% - 468px\)/);
  assert.doesNotMatch(styles, /max-width: 899px/);
});

test("lays every dot out with the measured pitch", async () => {
  const { RAIL_ROW_PX } = await import("../lib/transcript-rail.ts");
  // 空间足够时节距就是命中区高度 14px；放不下时由 railDotPitch 压缩节距，
  // 每条提问仍然保留一个可见圆点。
  assert.equal(RAIL_ROW_PX, 14);
  assert.match(source, /style=\{\{ height: pitch \}\}/);
  assert.match(source, /const block = RAIL_STEP_HEIGHT_PX \* 2 \+ RAIL_ROW_GAP_PX \* 2;/);
  assert.match(source, /const next = railDotPitch\(laneHeight - block, dots\.length\);/);
  assert.doesNotMatch(styles, /\.transcript-rail-dot::before/);
  assert.match(declarations(".transcript-rail-dot {"), /width: var\(--transcript-rail-lane\);/);
});

test("keeps the tip offset on the lane variables", () => {
  const region = declarations(".chat-transcript-region");
  assert.match(region, /--transcript-rail-tip-gap: 8px;/);
  // 提示间距与车道宽都由 CSS 变量算出，组件里不再出现「车道宽 + 8」这种手算。
  assert.match(
    declarations(".transcript-rail-tip"),
    /right: calc\(var\(--transcript-rail-lane\) \+ var\(--transcript-rail-tip-gap\)\);/,
  );
  assert.match(declarations(".transcript-rail {"), /width: var\(--transcript-rail-lane\);/);
  assert.doesNotMatch(source, /RAIL_WIDTH_PX/);
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
  const region = declarations(".chat-transcript-region");
  assert.ok(region, "missing .chat-transcript-region");
  const inset = customPixel(region, "chat-column-width") / 2
    + customPixel(region, "chat-column-padding")
    + GAP_PX;
  const laneQueryMaxPx = 2 * (inset + LANE_PX + MARGIN_PX) - 1;
  // 放不下整条车道就是放不下：整条 display: none 收起，隐藏时元素不可聚焦。
  assert.match(
    styles,
    new RegExp(`@container transcript-rail-lane \\(max-width: ${laneQueryMaxPx}px\\) \\{\\s*\\.transcript-rail \\{\\s*display: none;`),
  );
  // 不支持内联尺寸容器查询的浏览器读不到那条规则：回退按同一选择器收起，跳转条不会
  // 一直显示、在 769–943px 的转写区压住正文右缘。
  assert.match(
    styles,
    /@supports not \(container-type: inline-size\) \{\s*\.transcript-rail \{\s*display: none;\s*\}\s*\}/,
  );
  // 移动档与桌面档是同一个选择器、都在未分层样式里，优先级相同，靠后声明即可覆盖。
  const baseRule = styles.indexOf(".transcript-rail {");
  const mobileMedia = styles.lastIndexOf("@media (max-width: 768px), (pointer: coarse) and (max-width: 1023px)");
  assert.ok(baseRule > 0 && mobileMedia > baseRule, "the mobile rule must be declared after the desktop rule");
  assert.match(styles.slice(mobileMedia), /\.transcript-rail \{\s*display: none;\s*\}/);
  // 只有一轮提问时干脆不渲染，圆点与按钮都不存在。
  assert.match(chatWindow, /shouldShowTranscriptRail\(railDots\.length\) && \(\s*<TranscriptRail/);
  // 圆点用 roving tabindex：只有当前圆点进 Tab 序列，方向键在圆点之间移动，
  // 长会话不会让每个圆点都成为一次 Tab 停留。
  assert.match(source, /tabIndex=\{index === activeDotIndex \? 0 : -1\}/);
  assert.match(source, /onKeyDown=\{\(event\) => handleDotKeyDown\(event, index\)\}/);
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

test("compresses the dot column instead of scrolling it", () => {
  // 全部圆点都要露出来：列高由节距乘数量得出，节距按可用高度均分；列内滚动与
  // 滚动位置居中都不再存在。
  assert.match(source, /const block = RAIL_STEP_HEIGHT_PX \* 2 \+ RAIL_ROW_GAP_PX \* 2;/);
  // 车道连按钮块都放不下时整条收起，不把圆点压到按钮与正文上。
  assert.match(source, /if \(laneHeight <= block\) \{\s*setDotPitch\(null\);\s*return;\s*\}/);
  assert.match(source, /const next = railDotPitch\(laneHeight - block, dots\.length\);/);
  assert.match(source, /style=\{\{\s*height: pitch \* dots\.length,\s*"--rail-dot-mark": `\$\{dotMarkPx\}px`,\s*\} as CSSProperties\}/);
  // 节距低于可用下限时整条收起；车道仍在布局里，窗口缩放后能重新判断。
  assert.match(source, /style=\{\{ gap: RAIL_ROW_GAP_PX, display: railHidden \? "none" : undefined \}\}/);
  // 按钮块高度由常量给出，跳转条收起时不需要依赖上一次的测量。
  assert.match(source, /style=\{\{ height: RAIL_STEP_HEIGHT_PX \}\}/);
  // 窗口缩放改变高度时重算，不必等圆点数量变化。
  assert.match(source, /const observer = new ResizeObserver\(apply\);\s*observer\.observe\(lane\);/);
  assert.doesNotMatch(source, /railScrollTop/);
  assert.doesNotMatch(styles, /overflow-y: auto/);
});

test("reports whether the rail is actually visible", () => {
  // 移动档与窄转写区由 CSS 收起，JS 侧只量结果，不复制断点。
  assert.match(source, /onVisibilityChange\?: \(visible: boolean\) => void/);
  assert.match(
    source,
    /const rect = rail\.getBoundingClientRect\(\);\s*visibilityListenerRef\.current\?\.\(rect\.width > 0 && rect\.height > 0\)/,
  );
  // 卸载时收回可见性，调用方不会残留「还可见」的判断。
  assert.match(source, /visibilityListenerRef\.current\?\.\(false\)/);
});

test("describes each dot with the prompt it jumps to", () => {
  // 悬停提示是 aria-hidden 的浮层，圆点的可访问名之外还要把提问内容交给读屏。
  assert.match(source, /aria-describedby=\{promptId\}/);
  assert.match(source, /className="transcript-rail-prompt"/);
  assert.match(source, /t\("chat\.jumpToPromptDescription", \{ index: index \+ 1, prompt: dot\.prompt \}\)/);
  assert.match(declarations(".transcript-rail-prompt"), /clip-path: inset\(50%\);/);
  // 当前圆的语义不变：仍然只有一个 aria-current。
  assert.equal(source.match(/aria-current/g)?.length, 1);
});
