/**
 * 覆盖率门禁命令行测试共用的固定样本。
 *
 * 五个 `cli-*.test.mjs` 各有一份 lcov、git 桩与基准覆盖率桩，样本一改就要改五处；
 * 这里只留一份，各测试按需覆盖其中的字段。样本不读真实仓库，也不读磁盘。
 */

export const SAMPLE_MERGE_BASE = "0123456789abcdef0123456789abcdef01234567";

/** `[路径, 函数命中, 函数总数, 行命中, 行总数]` 拼成一份 lcov。 */
export function lcovOf(records) {
  return records
    .map(([path, functionsHit, functionsFound, linesHit, linesFound]) => [
      `SF:${path}`,
      `FNF:${functionsFound}`,
      `FNH:${functionsHit}`,
      `DA:1,${linesHit > 0 ? 1 : 0}`,
      `LF:${linesFound}`,
      `LH:${linesHit}`,
      "end_of_record",
    ].join("\n"))
    .join("\n");
}

/** 覆盖率索引里的一条文件指标。 */
export function metricsOf(path, functionsHit, functionsFound, linesHit = 0, linesFound = 0) {
  return { path, linesFound, linesHit, functionsFound, functionsHit };
}

/** `lib/hit.ts` 被加载且函数未全部调用：4 个函数命中 3 个，20 行命中 12 行。 */
export const HIT_LCOV = lcovOf([["lib\\hit.ts", 3, 4, 12, 20]]);

/** `lib/hit.ts` 分叉点版本的四个函数。 */
export const HIT_BASE_SOURCE = [
  "export function hit() {}",
  "export function one() {}",
  "export function two() {}",
  "export function three() {}",
].join("\n");

/** 命令行入口的 git 桩：一个修改的受管文件、一个新增的受管文件、一个非受管文件。 */
export function sampleGit(overrides = {}) {
  return {
    repositoryRoot: async () => "/repo",
    mergeBase: async () => SAMPLE_MERGE_BASE,
    changedFiles: async () => [
      { path: "lib/hit.ts", status: "modified" },
      { path: "lib/new.ts", status: "added" },
      { path: "README.md", status: "modified" },
    ],
    managedSourceFiles: async () => ["lib/hit.ts", "lib/new.ts", "lib/other.ts"],
    ...overrides,
  };
}

/** 只有受管文件改动时的 git 桩；改动清单由参数给出。 */
export function gitFor(changedFiles) {
  return {
    repositoryRoot: async () => "/repo",
    mergeBase: async () => SAMPLE_MERGE_BASE,
    changedFiles: async () => changedFiles,
    managedSourceFiles: async () => [...changedFiles.map((file) => file.path), "lib/other.ts"],
  };
}

/** 分叉点基准覆盖率的桩：`lib/hit.ts` 命中 3/4、行 12/20，耗时 36 秒。 */
export function sampleBaseCoverage(overrides = {}) {
  return async () => ({
    ok: true,
    coverage: new Map([["lib/hit.ts", metricsOf("lib/hit.ts", 3, 4, 12, 20)]]),
    durationMs: 36_000,
    ...overrides,
  });
}
