import assert from "node:assert/strict";
import test from "node:test";
import { runCoverageGate } from "./cli.ts";
import { HIT_BASE_SOURCE, lcovOf, sampleBaseCoverage, sampleGit } from "../../test-support/coverage-gate-fixtures.mjs";

const LCOV = [
  "SF:lib\\hit.ts",
  "FNF:4",
  "FNH:3",
  "DA:1,1",
  "DA:2,0",
  "LF:20",
  "LH:12",
  "end_of_record",
  "SF:lib\\hit.ts?mtime=1",
  "FNF:99",
  "FNH:99",
  "LF:99",
  "LH:99",
  "end_of_record",
  "SF:..\\..\\..\\.omp\\extensions\\x\\index.ts",
  "LF:8",
  "LH:3",
  "end_of_record",
].join("\n");

function run(overrides = {}) {
  return runCoverageGate(
    { cwd: "/repo", lcovPath: ".tmp/coverage-gate/lcov.info", baseRef: "origin/main" },
    {
      readText: async () => LCOV,
      git: sampleGit(),
      baseCoverage: sampleBaseCoverage(),
      sources: async () => ({ base: HIT_BASE_SOURCE, head: HIT_BASE_SOURCE }),
      ...overrides,
    },
  );
}

test("命令行输出改动文件、合计、剔除去重与缺席清单", async () => {
  const result = await run();

  assert.equal(result.exitCode, 1);
  assert.match(result.report, /规则判定：1 条/);
  assert.match(result.report, /\[rule-1\] lib\/new\.ts/);
  assert.match(result.report, /理由：文件未被任何测试加载/);
  assert.match(result.report, /改动文件：2 个受管源文件/);
  assert.match(result.report, /修改 {2}lib\/hit\.ts · 行 12\/20（60\.00%） · 函数 3\/4（75\.00%）/);
  assert.match(result.report, /新增 {2}lib\/new\.ts · 行 0\/0（未加载）/);
  assert.doesNotMatch(result.report, /README\.md/);
  assert.match(result.report, /行覆盖 12\/20（60\.00%）/);
  assert.match(result.report, /函数覆盖 3\/4（75\.00%）/);
  assert.match(result.report, /仓库外或越界记录剔除 1 条/);
  assert.match(result.report, /重复路径去重忽略 1 条/);
  assert.match(result.report, /报告缺席的受管源文件：2\/3/);
  assert.match(result.report, /^ {2}lib\/new\.ts$/m);
  assert.match(result.report, /^ {2}lib\/other\.ts$/m);
});

const LCOV_ALL_LOADED = lcovOf([
  ["lib\\hit.ts", 3, 4, 12, 20],
  ["lib\\new.ts", 2, 2, 8, 8],
]);

test("改动文件都有产物记录且新增文件函数全被调用时退出码为 0", async () => {
  const result = await run({ readText: async () => LCOV_ALL_LOADED });

  assert.equal(result.exitCode, 0);
  assert.match(result.report, /规则判定：0 条/);
  assert.match(result.report, /本次没有判定结果，退出码为 0。/);
});

test("产物缺失时以退出码 2 结束，报告说明门禁没跑起来", async () => {
  const result = await run({
    readText: async () => {
      throw new Error("ENOENT: no such file");
    },
  });

  assert.equal(result.exitCode, 2);
  assert.match(result.report, /覆盖率门禁未能运行/);
  assert.match(result.report, /覆盖率产物缺失：\.tmp\/coverage-gate\/lcov\.info/);
  assert.match(result.report, /先运行 bun run coverage:gate/);
  assert.match(result.report, /退出码 2：门禁本身没有跑起来，不代表代码没有被测试。/);
});

test("分叉点读取失败时给出检出深度提示，退出码为 2", async () => {
  const result = await run({
    git: sampleGit({
      mergeBase: async () => {
        throw new Error("fatal: Not a valid object name origin/main");
      },
    }),
  });

  assert.equal(result.exitCode, 2);
  assert.match(result.report, /git 数据读取失败/);
  assert.match(result.report, /fetch-depth: 0/);
});

test("改动文件的函数增量按分叉点对照，同步增长时退出码为 0", async () => {
  const result = await run({ readText: async () => LCOV_ALL_LOADED });

  assert.equal(result.exitCode, 0);
  assert.match(result.report, /lib\/hit\.ts · 改动前 3\/4 · 改动后 3\/4 · 新增 0 · 删除 0 · 被调用数 \+0/);
  assert.match(result.report, /基准覆盖率现场生成，耗时 36\.0 秒/);
});

test("新增函数没被调用时退出码为 1，输出前后对照", async () => {
  const headSource = `${HIT_BASE_SOURCE}\nexport function added() {}`;
  const result = await run({
    readText: async () => LCOV_ALL_LOADED,
    sources: async () => ({ base: HIT_BASE_SOURCE, head: headSource }),
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.report, /\[rule-2\] lib\/hit\.ts/);
  assert.match(result.report, /数字：改动前 3\/4，改动后 3\/4，新增 1 个函数，被调用数增加 0/);
});

test("基准运行失败时输出流水线问题，不静默通过", async () => {
  const result = await run({
    readText: async () => LCOV_ALL_LOADED,
    baseCoverage: async () => ({
      ok: false,
      detail: "分叉点 0123456 的测试运行失败：1 test failed",
      durationMs: 12_000,
    }),
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.report, /基准覆盖率不可用（流水线问题）：分叉点 0123456 的测试运行失败/);
  assert.match(result.report, /\[rule-2\] （基准覆盖率）/);
  assert.match(result.report, /理由：.*流水线问题/);
});

test("基准数据获取抛出异常时转成流水线问题，报告照常输出", async () => {
  const result = await run({
    readText: async () => LCOV_ALL_LOADED,
    baseCoverage: async () => {
      throw new Error("EACCES: permission denied, mkdir '.tmp/coverage-gate-base'");
    },
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.report, /基准覆盖率不可用（流水线问题）：基准覆盖率获取异常：EACCES/);
  assert.match(result.report, /\[rule-2\] （基准覆盖率）/);
  assert.match(result.report, /理由：.*流水线问题/);
});

test("两版正文读取抛出异常时同样转成流水线问题", async () => {
  const result = await run({
    readText: async () => LCOV_ALL_LOADED,
    sources: async () => {
      throw new Error("EISDIR: illegal operation on a directory, read");
    },
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.report, /两版正文读取异常：lib\/hit\.ts：EISDIR/);
  assert.match(result.report, /\[rule-2\] （基准覆盖率）/);
});

test("函数结构比对抛出异常时同样转成流水线问题", async () => {
  const result = await run({
    readText: async () => LCOV_ALL_LOADED,
    // 正文不是字符串，比对阶段的语法树解析会抛错。
    sources: async () => ({ base: HIT_BASE_SOURCE, head: 5 }),
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.report, /函数结构比对异常/);
});
