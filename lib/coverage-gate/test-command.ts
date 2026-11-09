/**
 * 覆盖率测试命令与产物位置的唯一定义。
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
  return ["test", "--coverage", "--coverage-reporter=lcov", `--coverage-dir=${coverageDir}`];
}
