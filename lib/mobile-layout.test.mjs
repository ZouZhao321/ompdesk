import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  MOBILE_LAYOUT_QUERY,
  MOBILE_MAX_COARSE_HEIGHT,
  MOBILE_MAX_WIDTH,
} = await jiti.import("./mobile-layout.ts");

const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
const isMobileHookSource = await readFile(new URL("../hooks/useIsMobile.ts", import.meta.url), "utf8");

const mobileMediaQuery = `(max-width: ${MOBILE_MAX_WIDTH}px), (pointer: coarse) and (max-height: ${MOBILE_MAX_COARSE_HEIGHT}px)`;

test("移动档媒体查询串由断点常量拼出", () => {
  assert.equal(MOBILE_LAYOUT_QUERY, mobileMediaQuery);
});

test("globals.css 的移动档媒体查询与导出常量一致", () => {
  const queries = [...cssSource.matchAll(/@media ([^{]+)\{/g)].map((match) => match[1].trim());
  const coarsePointerQueries = queries.filter((query) => query.includes("pointer: coarse"));
  assert.equal(coarsePointerQueries.length, 3, "每个移动档块都应使用同一条媒体查询");
  for (const query of coarsePointerQueries) {
    assert.equal(query, mobileMediaQuery);
  }
  // 桌面档断点是移动档断点的补集，同样跟随常量。
  assert.ok(
    queries.includes(`(min-width: ${MOBILE_MAX_WIDTH + 1}px)`),
    "桌面档媒体查询应紧邻移动档断点之后开始",
  );
});

test("AppShell 内联的手机档媒体查询同样来自导出常量", () => {
  assert.ok(
    appShellSource.includes(`@media ${mobileMediaQuery} {`),
    "AppShell 的抽屉媒体查询必须与 lib/mobile-layout 的断点一致",
  );
});

test("useIsMobile 直接以整条媒体查询作为快照", () => {
  assert.match(isMobileHookSource, /import \{ MOBILE_LAYOUT_QUERY \} from "\.\.\/lib\/mobile-layout"/);
  assert.match(isMobileHookSource, /window\.matchMedia\(MOBILE_LAYOUT_QUERY\)/);
  assert.match(isMobileHookSource, /return mobileMediaQuery\.matches;/);
  // 视觉视口宽度会跟着缩放变，不能拿它当布局视口。
  assert.doesNotMatch(isMobileHookSource, /innerWidth|clientWidth|clientHeight|offsetWidth/);
});

test("移动档内的 16px 表单控件规则仍在移动档媒体查询之内", () => {
  const guardIndex = cssSource.indexOf("font-size: 16px !important");
  assert.ok(guardIndex >= 0, "移动档必须保留 16px 表单字号以阻止 iOS 聚焦缩放");

  const marker = `@media ${mobileMediaQuery} {`;
  const blockStarts = [];
  for (let cursor = cssSource.indexOf(marker); cursor >= 0; cursor = cssSource.indexOf(marker, cursor + marker.length)) {
    blockStarts.push(cursor);
  }
  assert.ok(blockStarts.length > 0, "globals.css 必须包含移动档媒体查询");
  const insideMobileBlock = blockStarts.some((start) => {
    const end = cssSource.indexOf("\n}", start);
    return end > start && guardIndex > start && guardIndex < end;
  });
  assert.ok(insideMobileBlock, "16px 表单字号规则不得落到移动档媒体查询之外");
});
