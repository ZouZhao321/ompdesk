import assert from "node:assert/strict";
import test from "node:test";
import {
  bumpVersion,
  changelogKindProblem,
  classifyVersion,
  compareVersions,
  countCycleFeatures,
  extractChangelogSection,
  inferContentKind,
  lastFixVersion,
  normalizeVersion,
  promoteChangelog,
  unpublishedEntries,
} from "./release";

test("版本号只接受三段数字", () => {
  assert.equal(normalizeVersion("v1.2.3"), "1.2.3");
  assert.equal(normalizeVersion("1.2.3"), "1.2.3");
  assert.equal(normalizeVersion("1.2"), null);
  assert.equal(normalizeVersion("1.2.3-rc.1"), null);
  assert.equal(normalizeVersion("01.2.3"), null);
});

test("按最新标签的段位递增", () => {
  assert.equal(bumpVersion("1.0.26", "patch"), "1.0.27");
  assert.equal(bumpVersion("1.0.26", "minor"), "1.1.0");
  assert.equal(bumpVersion("1.0.26", "major"), "2.0.0");
});

test("比较按数字段推进", () => {
  assert.equal(compareVersions("1.0.27", "1.0.26"), 1);
  assert.equal(compareVersions("1.0.26", "1.0.26"), 0);
  assert.equal(compareVersions("1.9.0", "1.10.0"), -1);
});

const SAMPLE = `# 更新记录

发版按需进行。

## 未发布

- feat(telemetry)：接入 OTLP 导出链路（#13）
- fix(sidebar)：项目行未读徽标按静态状态着色（#93）

## [1.0.26] - 2026-11-02

- feat(settings)：设置窗口文案跟随界面语言（#108）
`;

test("把未发布段落转成带日期的版本，并留一个新的未发布", () => {
  const promoted = promoteChangelog(SAMPLE, "1.0.27", "2026-11-03");
  assert.match(promoted, /## 未发布\n\n## \[1\.0\.27\] - 2026-11-03\n\n- feat\(telemetry\)/);
  assert.match(promoted, /## \[1\.0\.26\] - 2026-11-02/);
  assert.equal(
    extractChangelogSection(promoted, "1.0.27"),
    "- feat(telemetry)：接入 OTLP 导出链路（#13）\n- fix(sidebar)：项目行未读徽标按静态状态着色（#93）",
  );
});

test("未发布段落为空时拒绝发版", () => {
  assert.throws(() => promoteChangelog("## 未发布\n\n## [1.0.26] - 2026-11-02\n\n- a\n", "1.0.27", "2026-11-03"), /空/);
});

test("缺少未发布段落时拒绝发版", () => {
  assert.throws(() => promoteChangelog("## [1.0.26] - 2026-11-02\n\n- a\n", "1.0.27", "2026-11-03"), /未发布/);
});

test("版本段落按完整标题匹配，不接受更长版本的前缀", () => {
  assert.throws(() => extractChangelogSection(SAMPLE, "1.0.2"), /1\.0\.2/);
});

test("未发布条目只取短横线开头的行", () => {
  assert.deepEqual(unpublishedEntries(SAMPLE), [
    "- feat(telemetry)：接入 OTLP 导出链路（#13）",
    "- fix(sidebar)：项目行未读徽标按静态状态着色（#93）",
  ]);
});

test("功能版本要求至少一条 feat 记录", () => {
  assert.equal(changelogKindProblem("feature", SAMPLE), null);
  assert.match(
    changelogKindProblem("feature", "## 未发布\n\n- fix(x)：修一下\n\n## [1.0.0] - 2026-01-01\n") ?? "",
    /feat/,
  );
});

test("修复版本拒绝 feat 记录", () => {
  assert.match(changelogKindProblem("fix", SAMPLE) ?? "", /feat/);
  assert.equal(changelogKindProblem("fix", "## 未发布\n\n- fix(x)：修一下\n- docs：补文档\n"), null);
});

test("指定版本号按与最新标签的差值判断记录类型", () => {
  assert.equal(inferContentKind("1.1.0", "1.0.28"), "feature");
  assert.equal(inferContentKind("1.1.1", "1.1.0"), "fix");
  assert.equal(inferContentKind("2.0.0", "1.1.1"), null);
});

test("版本递增类型", () => {
  assert.equal(classifyVersion("2.0.0", "1.9.9"), "major");
  assert.equal(classifyVersion("1.10.0", "1.9.0"), "feature");
  assert.equal(classifyVersion("1.9.1", "1.9.0"), "fix");
  assert.equal(classifyVersion("1.9.0", "1.9.0"), "same");
});

const CYCLE = `# 更新记录

## 未发布

- fix(x)：修一下

## [1.1.1] - 2026-11-05

- fix(y)：再修一下

## [1.1.0] - 2026-11-04

- feat(a)：功能一
- feat(b)：功能二

## [1.0.28] - 2026-11-03

- fix(c)：旧修复
`;

test("取最近一次修复版本", () => {
  assert.equal(lastFixVersion(["v1.0.27", "v1.0.28"]), "1.0.28");
  assert.equal(lastFixVersion(["v1.0.27", "v1.0.28", "v1.1.0"]), "1.0.28");
  assert.equal(lastFixVersion(["v1.0.28", "v1.1.0", "v1.1.1"]), "1.1.1");
});

test("统计本周期已发布的功能记录", () => {
  assert.equal(countCycleFeatures(CYCLE, ["v1.0.28", "v1.1.0"]), 2);
  assert.equal(countCycleFeatures(CYCLE, ["v1.0.28", "v1.1.0", "v1.1.1"]), 0);
});
