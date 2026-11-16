/**
 * 场景：文件树列举与 Git 忽略判定。
 *
 * 走真实模块的真实调用路径：对夹具仓库列举一次文件树、问一次忽略规则，再对非 git 目录
 * 列举一次以验证降级。任何一步不符合预期都抛错，由被测进程入口写进结果文件。
 */
import path from "node:path";
import { createJiti } from "jiti";

/** 夹具仓库里的名字：普通文件、被忽略的文件、被忽略目录里的文件。 */
const PLAIN_FILE = "plain.txt";
const IGNORED_FILE = "ignored.txt";
const IGNORED_DIR_FILE = "ignored-dir/inner.txt";

function fail(message, observed) {
  throw new Error(`${message}（实际：${JSON.stringify(observed)}）`);
}

export async function run() {
  const cwd = process.env.OMPDESK_CONSOLE_SCENARIO_CWD;
  if (!cwd) throw new Error("缺少 OMPDESK_CONSOLE_SCENARIO_CWD");
  const plainCwd = process.env.OMPDESK_CONSOLE_SCENARIO_PLAIN_CWD;
  if (!plainCwd) throw new Error("缺少 OMPDESK_CONSOLE_SCENARIO_PLAIN_CWD");

  const root = path.join(import.meta.dir, "..", "..");
  const jiti = createJiti(import.meta.url);
  const { listGitFiles } = await jiti.import(path.join(root, "lib", "git-listing.ts"));
  const { checkIgnoredEntries } = await jiti.import(path.join(root, "lib", "git-ignore.ts"));

  const listed = await listGitFiles(cwd);
  if (!Array.isArray(listed)) fail(`列举没有返回文件列表：${cwd}`, listed);
  if (!listed.includes(PLAIN_FILE)) fail("列举结果缺少普通文件", listed);
  if (listed.includes(IGNORED_FILE)) fail("列举结果包含了被忽略的文件", listed);
  if (listed.includes(IGNORED_DIR_FILE)) fail("列举结果包含了被忽略目录里的文件", listed);

  const names = [PLAIN_FILE, IGNORED_FILE, IGNORED_DIR_FILE];
  const ignored = await checkIgnoredEntries(cwd, names);
  if (!(ignored instanceof Set)) fail(`忽略判定没有返回名字集合：${cwd}`, ignored);
  if (ignored.has(PLAIN_FILE)) fail("普通文件被判成被忽略", [...ignored]);
  if (!ignored.has(IGNORED_FILE)) fail("被忽略的文件没有被判成被忽略", [...ignored]);
  if (!ignored.has(IGNORED_DIR_FILE)) fail("被忽略目录里的文件没有被判成被忽略", [...ignored]);

  // 不是 git 仓库时的降级：调用方据 null 退回目录遍历，所以既不能抛错也不能给空数组。
  const degraded = await listGitFiles(plainCwd);
  if (degraded !== null) fail(`非 git 目录没有降级成 null：${plainCwd}`, degraded);
}
