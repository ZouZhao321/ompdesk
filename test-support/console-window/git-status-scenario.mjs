/**
 * 场景：git 状态与 diff。
 *
 * 走真实模块的真实调用路径，对夹具仓库取一次状态与一次差异；任何一步失败都抛错，
 * 由被测进程入口写进结果文件。
 */
import path from "node:path";
import { createJiti } from "jiti";

export async function run() {
  const cwd = process.env.OMPDESK_CONSOLE_SCENARIO_CWD;
  if (!cwd) throw new Error("缺少 OMPDESK_CONSOLE_SCENARIO_CWD");

  const root = path.join(import.meta.dir, "..", "..");
  const jiti = createJiti(import.meta.url);
  const { getGitStatus, getGitFileDiff } = await jiti.import(path.join(root, "lib", "git-changes.ts"));

  const status = await getGitStatus(cwd);
  if (!status.isGitRepository) throw new Error(`夹具仓库没有被识别为 git 仓库：${cwd}`);
  if (!Array.isArray(status.files) || status.files.length === 0) throw new Error("git 状态没有列出改动的文件");

  const diff = await getGitFileDiff(cwd, path.join(cwd, "modified.txt"));
  if (!diff || typeof diff !== "object") throw new Error("diff 没有返回结果");
  if (!diff.supported || typeof diff.patch !== "string")
    throw new Error(`diff 结果不符合预期：${JSON.stringify(diff)}`);
}
