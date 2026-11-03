import assert from "node:assert/strict";
import test from "node:test";
import {
	bumpVersion,
	compareVersions,
	extractChangelogSection,
	normalizeVersion,
	promoteChangelog,
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
