import assert from "node:assert/strict";
import test from "node:test";
import { coverageTestArgs, coverageTestEnv, parseTestSummary } from "./test-command.ts";

test("测试命令只有一份定义，产物目录可替换", () => {
  assert.deepEqual(coverageTestArgs(), [
    "test",
    "--coverage",
    "--coverage-reporter=lcov",
    "--coverage-dir=.tmp/coverage-gate",
  ]);
  assert.ok(coverageTestArgs(".tmp/base").includes("--coverage-dir=.tmp/base"));
});

test("判定前固定环境：真实模型冒烟开关一律关掉", () => {
  const env = coverageTestEnv({
    OMPDESK_LIVE_SMOKE: "1",
    OMPDESK_LIVE_MODEL: "anthropic/claude-sonnet-4-5",
    PATH: "/usr/bin",
  });

  assert.equal(env.OMPDESK_LIVE_SMOKE, "0");
  assert.equal(env.OMPDESK_LIVE_MODEL, "0");
  // 其余环境原样保留：固定的是开关，不是整份环境。
  assert.equal(env.PATH, "/usr/bin");
});

test("从 bun test 的统计行取用例数", () => {
  const output = [
    " 1352 pass",
    " 3 skip",
    " 0 fail",
    "Ran 1352 tests across 295 files. [36.00s]",
  ].join("\n");

  assert.deepEqual(parseTestSummary(output), { passed: 1352, skipped: 3, failed: 0 });
});

test("没有跳过用例时数量记 0", () => {
  const output = [" 7 pass", " 0 fail", "Ran 7 tests across 2 files."].join("\n");

  assert.deepEqual(parseTestSummary(output), { passed: 7, skipped: 0, failed: 0 });
});

test("输出里没有统计行时返回 null，由报告写明数量未知", () => {
  assert.equal(parseTestSummary("bun test v1.4.2\n"), null);
});
