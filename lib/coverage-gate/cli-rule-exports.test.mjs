import assert from "node:assert/strict";
import test from "node:test";
import { runCoverageGate } from "./cli.ts";

const LCOV = [
  "SF:lib\\new.ts",
  "FNF:1",
  "FNH:1",
  "LF:3",
  "LH:3",
  "end_of_record",
  "SF:lib\\use.ts",
  "FNF:1",
  "FNH:1",
  "LF:2",
  "LH:2",
  "end_of_record",
].join("\n");

const NEW_FILE = "export function lonely(): number {\n  return 1;\n}\n";
const UNUSED_CONSUMER = "export const value = 1;\n";
const USED_CONSUMER = 'import { lonely } from "./new";\nexport const value = lonely();\n';

/** 固定样本：受管文件两处，改动只有新增的 lib/new.ts。 */
function run(sources) {
  return runCoverageGate(
    { cwd: "/repo", lcovPath: ".tmp/coverage-gate/lcov.info", baseRef: "origin/main" },
    {
      readText: async (filePath) => {
        const normalized = filePath.replace(/\\/g, "/");
        if (normalized.endsWith("lcov.info")) return LCOV;
        const relative = normalized.slice(normalized.indexOf("lib/"));
        return sources[relative];
      },
      readBaseText: async () => null,
      readBaseline: async () => null,
      git: {
        repositoryRoot: async () => "/repo",
        mergeBase: async () => "0123456789abcdef0123456789abcdef01234567",
        changedFiles: async () => [{ path: "lib/new.ts", status: "added" }],
        managedSourceFiles: async () => ["lib/new.ts", "lib/use.ts"],
      },
    },
  );
}

test("新增导出没有生产引用时退出码为 1", async () => {
  const result = await run({ "lib/new.ts": NEW_FILE, "lib/use.ts": UNUSED_CONSUMER });

  assert.equal(result.exitCode, 1);
  assert.match(result.report, /\[rule-3\] lib\/new\.ts/);
  assert.match(result.report, /lonely（运行时导出）生产引用 0/);
  assert.match(result.report, /测试文件不计入生产引用/);
});

test("同样的改动补上生产引用后退出码回到 0", async () => {
  const result = await run({ "lib/new.ts": NEW_FILE, "lib/use.ts": USED_CONSUMER });

  assert.equal(result.exitCode, 0);
  assert.match(result.report, /规则判定：0 条/);
});
