import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { MOBILE_COARSE_MAX_WIDTH, MOBILE_LAYOUT_QUERY, MOBILE_MAX_WIDTH } = await jiti.import("./mobile-layout.ts");

const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
const isMobileHookSource = await readFile(new URL("../hooks/useIsMobile.ts", import.meta.url), "utf8");

test("移动档媒体查询串由断点常量拼出", () => {
  assert.equal(
    MOBILE_LAYOUT_QUERY,
    `(max-width: ${MOBILE_MAX_WIDTH}px), (pointer: coarse) and (max-width: ${MOBILE_COARSE_MAX_WIDTH}px)`,
  );
});

test("粗指针分支只看指针与宽度，软键盘压短视口不会改写判定", () => {
  const coarseBranch = MOBILE_LAYOUT_QUERY.split(",")
    .map((part) => part.trim())
    .find((part) => part.includes("pointer: coarse"));
  assert.ok(coarseBranch, "必须保留粗指针分支");
  assert.match(coarseBranch, new RegExp(`max-width: ${MOBILE_COARSE_MAX_WIDTH}px`));
  assert.ok(MOBILE_COARSE_MAX_WIDTH > MOBILE_MAX_WIDTH, "触屏上界必须宽于窄屏断点，横屏手机才不会被漏在移动档之外");
  // 视口高度会被软键盘压缩，任何高度维度都会让 769–1023px 宽的触屏设备跳档。
  assert.doesNotMatch(MOBILE_LAYOUT_QUERY, /height/);
});

test("globals.css 的移动档媒体查询与导出常量一致", () => {
  const queries = [...cssSource.matchAll(/@media ([^{]+)\{/g)].map((match) => match[1].trim());
  const coarsePointerQueries = queries.filter((query) => query.includes("pointer: coarse"));
  assert.ok(coarsePointerQueries.length > 0, "至少有一个移动档块");
  for (const query of coarsePointerQueries) {
    assert.equal(query, MOBILE_LAYOUT_QUERY);
  }
  // 桌面档断点是移动档断点的补集，同样跟随常量。
  assert.ok(queries.includes(`(min-width: ${MOBILE_MAX_WIDTH + 1}px)`), "桌面档媒体查询应紧邻移动档断点之后开始");
});

test("AppShell 内联的手机档媒体查询与命中区同样来自导出常量", () => {
  assert.match(appShellSource, /import \{[^}]*MOBILE_LAYOUT_QUERY[^}]*\} from "@\/lib\/mobile-layout"/);
  assert.ok(
    appShellSource.includes(`@media \${MOBILE_LAYOUT_QUERY} {`),
    "AppShell 的抽屉媒体查询必须取自 lib/mobile-layout 的常量",
  );
  assert.ok(
    appShellSource.includes(`min-width: \${MOBILE_HIT_TARGET_PX}px;`),
    "手机档命中区必须取自 MOBILE_HIT_TARGET_PX",
  );
  // 内联样式不再重复写死断点与命中区的数值。
  assert.doesNotMatch(appShellSource, /max-width: 768px|max-height: 480px|min-width: 44px;/);
});

test("useIsMobile 以整条媒体查询的匹配状态作为快照", () => {
  assert.match(isMobileHookSource, /import \{ MOBILE_LAYOUT_QUERY \} from "\.\.\/lib\/mobile-layout"/);
  assert.match(isMobileHookSource, /window\.matchMedia\(MOBILE_LAYOUT_QUERY\)/);

  const snapshotSource = isMobileHookSource.slice(
    isMobileHookSource.indexOf("function getSnapshot"),
    isMobileHookSource.indexOf("function getServerSnapshot"),
  );
  assert.ok(snapshotSource.length > 0, "getSnapshot 必须存在");
  // 只约束行为：快照读的就是这条媒体查询的匹配结果，不绑定具体变量名。
  assert.match(snapshotSource, /matchMedia\(MOBILE_LAYOUT_QUERY\)/);
  assert.match(snapshotSource, /\.matches/);
  // 渲染期不得创建或缓存单例：模块级不保留可变量。
  assert.doesNotMatch(isMobileHookSource, /^let /m);
  // 视觉视口宽度会跟着缩放变，不能拿它当布局视口。
  assert.doesNotMatch(isMobileHookSource, /innerWidth|clientWidth|clientHeight|offsetWidth/);
});

test("移动档内的 16px 表单控件规则仍在移动档媒体查询之内", () => {
  const guardIndex = cssSource.indexOf("font-size: 16px !important");
  assert.ok(guardIndex >= 0, "移动档必须保留 16px 表单字号以阻止 iOS 聚焦缩放");

  const marker = `@media ${MOBILE_LAYOUT_QUERY} {`;
  const blockStarts = [];
  for (
    let cursor = cssSource.indexOf(marker);
    cursor >= 0;
    cursor = cssSource.indexOf(marker, cursor + marker.length)
  ) {
    blockStarts.push(cursor);
  }
  assert.ok(blockStarts.length > 0, "globals.css 必须包含移动档媒体查询");
  const insideMobileBlock = blockStarts.some((start) => {
    const end = cssSource.indexOf("\n}", start);
    return end > start && guardIndex > start && guardIndex < end;
  });
  assert.ok(insideMobileBlock, "16px 表单字号规则不得落到移动档媒体查询之外");
});
