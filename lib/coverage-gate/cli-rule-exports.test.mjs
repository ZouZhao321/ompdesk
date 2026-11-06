import assert from "node:assert/strict";
import test from "node:test";
import { runExportGate } from "./cli.ts";
import { SAMPLE_MERGE_BASE } from "../../test-support/coverage-gate-fixtures.mjs";

const NEW_FILE = "export function lonely(): number {\n  return 1;\n}\n";
const UNUSED_CONSUMER = "export const value = 1;\n";
const USED_CONSUMER = 'import { lonely } from "./new";\nexport const value = lonely();\n';

/** 固定样本：受管文件两处，改动只有新增的 lib/new.ts。 */
function run(sources) {
  return runExportGate(
    { cwd: "/repo", baseRef: "origin/main" },
    {
      readText: async (filePath) => {
        const normalized = filePath.replace(/\\/g, "/");
        const relative = normalized.slice(normalized.indexOf("lib/"));
        return sources[relative];
      },
      readBaseText: async () => null,
      readBaseline: async () => null,
      readExceptions: async () => null,
      git: {
        repositoryRoot: async () => "/repo",
        mergeBase: async () => SAMPLE_MERGE_BASE,
        changedFiles: async () => [{ path: "lib/new.ts", status: "added" }],
        managedSourceFiles: async () => ["lib/new.ts", "lib/use.ts"],
      },
    },
  );
}

test("新增导出没有生产引用时退出码为 1，不跑测试", async () => {
  const result = await run({ "lib/new.ts": NEW_FILE, "lib/use.ts": UNUSED_CONSUMER });

  assert.equal(result.exitCode, 1);
  assert.match(result.report, /^覆盖率门禁·静态引用检查（本次有判定未通过）$/m);
  assert.match(result.report, /\[rule-3\] lib\/new\.ts/);
  assert.match(result.report, /lonely（运行时导出）生产引用 0/);
  assert.match(result.report, /测试文件不计入生产引用/);
  assert.match(result.report, /退出码非零；未运行测试。/);
});

test("同样的改动补上生产引用后退出码回到 0", async () => {
  const result = await run({ "lib/new.ts": NEW_FILE, "lib/use.ts": USED_CONSUMER });

  assert.equal(result.exitCode, 0);
  assert.match(result.report, /规则判定：0 条/);
  assert.match(result.report, /本次没有判定结果，退出码为 0，继续运行测试。/);
});

test("源码读不出来时退出码为 2，报告说明门禁没跑起来", async () => {
  const result = await runExportGate(
    { cwd: "/repo", baseRef: "origin/main" },
    {
      readText: async () => {
        throw new Error("EACCES: permission denied");
      },
      readBaseline: async () => null,
      readExceptions: async () => null,
      readBaseText: async () => null,
      git: {
        repositoryRoot: async () => "/repo",
        mergeBase: async () => SAMPLE_MERGE_BASE,
        changedFiles: async () => [{ path: "lib/new.ts", status: "added" }],
        managedSourceFiles: async () => ["lib/new.ts"],
      },
    },
  );

  assert.equal(result.exitCode, 2);
  assert.match(result.report, /覆盖率门禁未能运行/);
  assert.match(result.report, /导出引用分析失败：EACCES/);
  assert.match(result.report, /不代表代码没有被测试/);
});
