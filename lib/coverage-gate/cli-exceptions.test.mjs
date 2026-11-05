import assert from "node:assert/strict";
import test from "node:test";
import { runCoverageGate } from "./cli.ts";

const TODAY = "2026-11-06";

const LCOV = [
  "SF:lib\\hit.ts",
  "FNF:4",
  "FNH:3",
  "LF:20",
  "LH:12",
  "end_of_record",
].join("\n");

const BASE_SOURCE = [
  "export function hit() {}",
  "export function one() {}",
  "export function two() {}",
  "export function three() {}",
].join("\n");

const DEFAULT_CHANGES = [
  { path: "lib/hit.ts", status: "modified" },
  { path: "lib/new.ts", status: "added" },
];

function gitFor(changedFiles) {
  return {
    repositoryRoot: async () => "/repo",
    mergeBase: async () => "0123456789abcdef0123456789abcdef01234567",
    changedFiles: async () => changedFiles,
    managedSourceFiles: async () => [...changedFiles.map((file) => file.path), "lib/other.ts"],
  };
}

function exceptionText(overrides = {}) {
  return JSON.stringify({
    exceptions: [{
      file: "lib/new.ts",
      rule: "rule-1",
      reason: "只做类型声明",
      verification: "bun run typecheck",
      expiresOn: "2026-12-31",
      ...overrides,
    }],
  });
}

function run({ exceptions = null, changes = DEFAULT_CHANGES } = {}) {
  return runCoverageGate(
    { cwd: "/repo", lcovPath: ".tmp/coverage-gate/lcov.info", baseRef: "origin/main" },
    {
      readText: async () => LCOV,
      readExceptions: async () => exceptions,
      today: TODAY,
      git: gitFor(changes),
      baseCoverage: async () => ({
        ok: true,
        coverage: new Map([
          ["lib/hit.ts", {
            path: "lib/hit.ts",
            linesFound: 20,
            linesHit: 12,
            functionsFound: 4,
            functionsHit: 3,
          }],
        ]),
        durationMs: 36_000,
        worktreePath: "/repo/.tmp/coverage-gate-base/base",
      }),
      sources: async () => ({ base: BASE_SOURCE, head: BASE_SOURCE }),
    },
  );
}

test("生效中的豁免放行登记判定，报告标注理由与替代验证", async () => {
  const result = await run({ exceptions: exceptionText() });

  assert.equal(result.exitCode, 0);
  assert.match(result.report, /规则判定：0 条/);
  assert.match(result.report, /豁免清单（coverage-exceptions\.json，复核日期 2026-11-06）/);
  assert.match(result.report, /生效 1 条（对应判定不阻断）/);
  assert.match(result.report, /\[rule-1\] lib\/new\.ts · 到期 2026-12-31/);
  assert.match(result.report, /理由：只做类型声明/);
  assert.match(result.report, /替代验证：bun run typecheck/);
  assert.match(result.report, /放行：产物记录 0 条（函数 0\/0） · 文件未被任何测试加载/);
  assert.match(result.report, /本次没有判定结果，退出码为 0。/);
});

test("到期的豁免重新拦截，报告指出已到期", async () => {
  const result = await run({ exceptions: exceptionText({ expiresOn: "2026-10-01" }) });

  assert.equal(result.exitCode, 1);
  assert.match(result.report, /规则判定：1 条/);
  assert.match(result.report, /\[rule-1\] lib\/new\.ts\n\s+数字：产物记录 0 条/);
  assert.match(result.report, /已到期 1 条（规则重新拦截）/);
  assert.match(result.report, /到期 2026-10-01（已到期）/);
  assert.match(result.report, /本次 1 条判定未通过，退出码非零。/);
});

test("豁免条目缺少字段时校验失败且退出码非零", async () => {
  const result = await run({
    exceptions: JSON.stringify({
      exceptions: [{
        file: "lib/new.ts",
        rule: "rule-1",
        reason: "只做类型声明",
        expiresOn: "2026-12-31",
      }],
    }),
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.report, /校验失败 1 条（退出码非零）/);
  assert.match(result.report, /第 1 条缺少字段 verification（替代验证方式）/);
  assert.match(result.report, /规则判定：1 条/);
  assert.match(
    result.report,
    /本次 1 条判定未通过，豁免清单 1 条校验失败，退出码非零。/,
  );
});

test("只有豁免校验失败时报告标题指向豁免清单，退出码非零", async () => {
  const result = await run({
    exceptions: JSON.stringify({
      exceptions: [
        {
          file: "lib/new.ts",
          rule: "rule-1",
          reason: "只做类型声明",
          verification: "bun run typecheck",
          expiresOn: "2026-12-31",
        },
        {
          file: "lib/other.ts",
          rule: "rule-1",
          reason: "到期日写错",
          verification: "bun run typecheck",
          expiresOn: "2026-02-30",
        },
      ],
    }),
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.report, /^覆盖率门禁（豁免清单校验未通过）$/m);
  assert.match(result.report, /规则判定：0 条/);
  assert.match(result.report, /校验失败 1 条（退出码非零）/);
  assert.match(result.report, /豁免清单 1 条校验失败，退出码非零。/);
});

test("豁免只放行登记的文件，其他文件的同类判定仍然拦截", async () => {
  const result = await run({
    exceptions: exceptionText(),
    changes: [...DEFAULT_CHANGES, { path: "lib/other-new.ts", status: "added" }],
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.report, /规则判定：1 条/);
  assert.match(result.report, /\[rule-1\] lib\/other-new\.ts\n\s+数字：/);
  assert.match(result.report, /放行：产物记录 0 条/);
  assert.doesNotMatch(result.report, /\[rule-1\] lib\/new\.ts\n\s+数字：/);
});

test("豁免只放行登记的规则，同一文件的另一条判定仍然拦截", async () => {
  const result = await run({ exceptions: exceptionText({ rule: "rule-2" }) });

  assert.equal(result.exitCode, 1);
  assert.match(result.report, /规则判定：1 条/);
  assert.match(result.report, /\[rule-1\] lib\/new\.ts\n\s+数字：/);
  assert.match(result.report, /生效 1 条（对应判定不阻断）/);
  assert.doesNotMatch(result.report, /放行：/);
});

test("清单文件不存在时按没有登记处理", async () => {
  const result = await run();

  assert.equal(result.exitCode, 1);
  assert.match(result.report, /豁免清单（coverage-exceptions\.json，复核日期 2026-11-06）/);
  assert.match(result.report, /清单文件不存在，按没有登记处理。/);
  assert.match(result.report, /\[rule-1\] lib\/new\.ts/);
});

test("清单为空数组时报告说明没有登记豁免", async () => {
  const result = await run({ exceptions: JSON.stringify({ exceptions: [] }) });

  assert.equal(result.exitCode, 1);
  assert.match(result.report, /没有登记豁免。/);
  assert.match(result.report, /规则判定：1 条/);
});

test("清单不是合法 JSON 时校验失败且退出码非零", async () => {
  const result = await run({ exceptions: "{" });

  assert.equal(result.exitCode, 1);
  assert.match(result.report, /校验失败 1 条（退出码非零）/);
  assert.match(result.report, /清单整体：不是合法 JSON/);
});
