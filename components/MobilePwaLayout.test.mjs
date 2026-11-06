import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { readSource } from "../test-support/source-text";

const jiti = createJiti(import.meta.url);
const { MOBILE_HIT_TARGET_PX, MOBILE_LAYOUT_QUERY } = await jiti.import("../lib/mobile-layout.ts");

/** 移动档媒体查询串：CSS 必须与 lib/mobile-layout 的导出常量逐字一致。 */
const mobileMediaQuery = MOBILE_LAYOUT_QUERY;

const layoutSource = await readSource(new URL("../app/layout.tsx", import.meta.url));
const cssSource = await readSource(new URL("../app/globals.css", import.meta.url));
const appShellSource = await readSource(new URL("./AppShell.tsx", import.meta.url));
const chatWindowSource = await readSource(new URL("./ChatWindow.tsx", import.meta.url));
const chatInputSource = await readSource(new URL("./ChatInput.tsx", import.meta.url));
const tabBarSource = await readSource(new URL("./TabBar.tsx", import.meta.url));
const viewportHookSource = await readSource(
  new URL("../hooks/useViewportHeight.ts", import.meta.url),
);

/**
 * 取最后一段移动档媒体查询的内容。
 *
 * 压平空白后没有行边界可用，改按大括号配对找块尾；globals.css 的声明值里没有
 * 裸大括号，扫描不会数错层级。
 */
function lastMobileMediaBlock(css) {
  const marker = `@media ${mobileMediaQuery} {`;
  const start = css.lastIndexOf(marker);
  assert.ok(start >= 0, "globals.css must keep the mobile media query");
  let depth = 0;
  for (let index = start + marker.length - 1; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(start, index);
    }
  }
  assert.fail("the last mobile media query block must be closed");
}

test("configures iOS standalone mode to use the full screen", () => {
  assert.match(layoutSource, /statusBarStyle: "default"/);
  assert.match(layoutSource, /viewportFit: "cover"/);
  assert.match(layoutSource, /interactiveWidget: "resizes-content"/);
});

test("tracks the visual viewport while the software keyboard is open", () => {
  assert.match(appShellSource, /useViewportHeight\(\)/);
  assert.match(appShellSource, /paddingTop: "env\(safe-area-inset-top\)"/);
  assert.match(appShellSource, /paddingBottom: "env\(safe-area-inset-bottom\)"/);
  assert.match(appShellSource, /paddingLeft: "env\(safe-area-inset-left\)"/);
  assert.match(appShellSource, /paddingRight: "env\(safe-area-inset-right\)"/);

  assert.match(appShellSource, /height: "var\(--app-viewport-height, 100dvh\)"/);
  assert.match(appShellSource, /right: "env\(safe-area-inset-right\)"/);
  assert.match(viewportHookSource, /window\.visualViewport/);
  assert.match(viewportHookSource, /window\.requestAnimationFrame\(update\)/);
  assert.match(viewportHookSource, /window\.addEventListener\("resize", scheduleUpdate\)/);
  assert.match(viewportHookSource, /window\.addEventListener\("focusout", scheduleUpdate\)/);
  assert.match(viewportHookSource, /--app-viewport-height/);
  assert.match(viewportHookSource, /window\.scrollTo\(0, 0\)/);
  assert.match(cssSource, /height: var\(--app-viewport-height, 100dvh\)/);
  assert.match(cssSource, /left: env\(safe-area-inset-left\)/);
  assert.match(chatWindowSource, /paddingBottom: "env\(safe-area-inset-bottom\)"/);
});

test("contains chat content and inputs within the mobile viewport", () => {
  assert.match(
    cssSource,
    /\.markdown-body \{[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;[\s\S]*?overflow-x: hidden;/,
  );
  assert.match(cssSource, /\.markdown-code-block \{[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;/);
  assert.match(chatWindowSource, /overflow-x-hidden overflow-y-auto/);
  assert.match(chatInputSource, /flex: 1,\s*minWidth: 0,\s*width: "100%",/);
});

test("prevents iOS focus zoom from widening the layout", () => {
  const mobileBlock = lastMobileMediaBlock(cssSource);
  assert.match(
    mobileBlock,
    /textarea,\s*input,\s*select \{\s*font-size: 16px !important;/,
    "form controls inside the mobile tier must keep 16px so iOS does not zoom on focus",
  );
});

test("手机档把文件面板页签栏与顶栏抬到同一命中区高度", () => {
  const mobileBlock = lastMobileMediaBlock(cssSource);
  // 右侧内边距留给悬浮的面板开关，最后一个页签的关闭按钮不会被盖住。
  assert.match(
    mobileBlock,
    new RegExp(`\\.panel-tab-bar \\{\\s*padding-right: ${MOBILE_HIT_TARGET_PX}px;`),
    "手机档页签栏右侧必须留出面板开关的位置",
  );
  // 页签尺寸由组件按 useIsMobile() 取值，CSS 不再用 !important 覆盖。
  assert.doesNotMatch(mobileBlock, /\.panel-tab-header \{/, "页签栏高度改由宿主容器内联决定");
  assert.doesNotMatch(mobileBlock, /\.panel-tab \{/, "页签高度改由 TabBar 内联决定");
  assert.doesNotMatch(mobileBlock, /\.panel-tab-close \{/, "关闭按钮命中区改由 TabBar 内联决定");
});

test("页签尺寸按移动档取自命中区常量，并挂上 CSS 钩子类名", () => {
  assert.match(tabBarSource, /className="panel-tab-bar"/);
  assert.match(tabBarSource, /className="panel-tab"/);
  assert.match(tabBarSource, /className="panel-tab-close"/);
  assert.match(tabBarSource, /const isMobile = useIsMobile\(\);/);
  assert.match(
    tabBarSource,
    new RegExp(`const barHeight = isMobile \\? MOBILE_HIT_TARGET_PX : \\d+;`),
    "手机档页签栏高度必须取自命中区常量",
  );
  assert.match(
    tabBarSource,
    new RegExp(`const closeSize = isMobile \\? MOBILE_HIT_TARGET_PX : \\d+;`),
    "手机档关闭按钮命中区必须取自命中区常量",
  );
  assert.match(tabBarSource, /height: barHeight,/);
  assert.match(tabBarSource, /width: closeSize, height: closeSize,/);
  // 宿主容器与页签同高，安全区另加。
  assert.match(
    appShellSource,
    /height: `calc\(\$\{topBar\.height\}px \+ env\(safe-area-inset-top\)\)`/,
    "页签栏容器高度必须跟随移动档顶栏尺寸",
  );
});

test("手机档输入区的附件删除按钮与两个浮层条目取命中区尺寸", () => {
  // 附件预览的删除圆点保持 16px 外观，命中区在手机档放大到命中区常量。
  assert.match(chatInputSource, /width: isMobile \? MOBILE_HIT_TARGET_PX : 16,/);
  assert.match(chatInputSource, /height: isMobile \? MOBILE_HIT_TARGET_PX : 16,/);
  assert.match(
    chatInputSource,
    /padding: "7px 8px",\s*\/\/ 手机档浮层条目也要够 44px 高才点得准。\s*minHeight: isMobile \? MOBILE_HIT_TARGET_PX : undefined,/,
    "历史记录浮层条目必须够高",
  );
  assert.match(
    chatInputSource,
    /padding: "6px 8px",\s*\/\/ 手机档浮层条目也要够 44px 高才点得准。\s*minHeight: isMobile \? MOBILE_HIT_TARGET_PX : undefined,/,
    "@ 文件浮层条目必须够高",
  );
});
