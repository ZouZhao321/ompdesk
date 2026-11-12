/**
 * 覆盖率测试命令、产物位置与运行环境的唯一定义。
 *
 * 本次运行、分叉点基准运行与合并检查用的是同一组参数：基准运行必须与本次运行完全一致，
 * 两侧数字才可比；工作流只调用 `bun run ci`，不另写测试命令。改动这里，三处一起变。
 */

/** 本次运行的覆盖率产物目录，相对仓库根；合并检查把它作为附件上传。 */
const COVERAGE_DIR = ".tmp/coverage-gate";

/** 覆盖率产物文件名，基准运行写在另一个目录下，文件名相同。 */
export const LCOV_FILE_NAME = "lcov.info";

/** 门禁读取的 lcov 路径，相对仓库根。 */
export const LCOV_PATH = `${COVERAGE_DIR}/${LCOV_FILE_NAME}`;

/** 产出 lcov 的测试参数，带上产物目录；基准运行换一个目录，参数其余部分不变。 */
export function coverageTestArgs(coverageDir: string = COVERAGE_DIR): string[] {
  return ["test", "--isolate", "--coverage", "--coverage-reporter=lcov", `--coverage-dir=${coverageDir}`];
}

/**
 * 判定前固定的环境：真实模型冒烟的两组开关一律关掉。用例本身按 `=== "1"` 判断是否运行，
 * 这里显式写 `0` 是为了挡住持续集成或本机环境里残留的开启值——判定结果不受外部开关
 * 影响，两次运行看到同一批用例。
 */
export function coverageTestEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, OMPDESK_LIVE_SMOKE: "0", OMPDESK_LIVE_MODEL: "0" };
}

/** 一次测试运行的用例统计。默认跳过的用例不进分子分母，报告里只注明数量。 */
export interface TestSummary {
  passed: number;
  skipped: number;
  failed: number;
}

/**
 * 从 `bun test` 的末尾统计行取用例数：`N pass`、`N skip`、`N fail` 三行。
 *
 * 取数方式是控制台输出而不是独立的机器可读产物：Bun 1.4 的 junit 产物需要 XML 解析
 * 器，仓库里没有这个依赖。局限是依赖 Bun 的输出格式，升级 Bun 时要复核这几行与
 * `test-command.test.mjs` 的样本；取不到数时返回 null，报告写明数量未知。
 */
export function parseTestSummary(output: string): TestSummary | null {
  const passed = /^\s*(\d+)\s+pass$/m.exec(output);
  const failed = /^\s*(\d+)\s+fail$/m.exec(output);
  if (!passed || !failed) return null;
  const skipped = /^\s*(\d+)\s+skip$/m.exec(output);
  return {
    passed: Number(passed[1]),
    skipped: skipped ? Number(skipped[1]) : 0,
    failed: Number(failed[1]),
  };
}
