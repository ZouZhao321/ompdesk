/**
 * 场景：worktree 的列举、创建与删除。
 *
 * 走真实模块的真实调用路径，对夹具仓库列举主检出、建一份副本、再删掉它，最后验证脏工作区
 * 的删除按既有错误语义失败。任何一步不符合预期都抛错，由被测进程入口写进结果文件。
 */
import fs from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";

/** 路径比较口径：git 打印正斜杠，夹具目录在 Windows 上还有大小写差异。 */
function pathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function assertPath(actual, expected, label) {
  if (pathKey(actual) !== pathKey(expected)) throw new Error(`${label}：期望 ${expected}，实际 ${actual}`);
}

/** 取一次预期内的失败与它的消息；没有失败就说明既有错误语义丢了。 */
async function expectFailure(label, action) {
  let message = null;
  try {
    await action();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  if (message === null) throw new Error(`${label} 没有报错`);
  return message;
}

export async function run() {
  const repo = process.env.OMPDESK_CONSOLE_SCENARIO_REPO;
  if (!repo) throw new Error("缺少 OMPDESK_CONSOLE_SCENARIO_REPO");

  const root = path.join(import.meta.dir, "..", "..");
  const jiti = createJiti(import.meta.url);
  const { addWorktree, listWorktrees, removeWorktree, resolveProject } = await jiti.import(
    path.join(root, "lib", "worktree.ts"),
  );

  const project = await resolveProject(repo);
  assertPath(project.projectRoot, repo, "主检出没有被认成项目根");
  if (project.isWorktree) throw new Error("主检出被认成了副本");
  if (project.branch !== "main") throw new Error(`主检出的分支不是 main：${project.branch}`);

  const initial = await listWorktrees(repo);
  if (initial.length !== 1)
    throw new Error(`新夹具仓库应只有主检出，实际 ${initial.length} 条：${JSON.stringify(initial)}`);
  if (!initial[0].isMain) throw new Error(`列举结果没有把主检出标成主检出：${JSON.stringify(initial[0])}`);
  assertPath(initial[0].path, repo, "列举结果里的主检出路径不对");

  // 创建：目录要真的落在磁盘上，列举要能看见它，主检出仍在。
  const created = await addWorktree(repo, "feat/console-window");
  if (created.branch !== "feat/console-window") throw new Error(`创建结果的分支不对：${created.branch}`);
  if (!fs.existsSync(created.path)) throw new Error(`副本目录没有出现在磁盘上：${created.path}`);
  if (!fs.existsSync(path.join(created.path, "README.md"))) throw new Error(`副本里没有检出内容：${created.path}`);

  const createdProject = await resolveProject(created.path);
  assertPath(createdProject.projectRoot, repo, "副本没有被归到主仓库");
  if (!createdProject.isWorktree) throw new Error(`副本没有被认成副本：${JSON.stringify(createdProject)}`);

  const afterCreate = await listWorktrees(repo);
  const listed = afterCreate.find((entry) => pathKey(entry.path) === pathKey(created.path));
  if (!listed) throw new Error(`列举不到刚创建的副本：${JSON.stringify(afterCreate)}`);
  if (listed.branch !== "feat/console-window") throw new Error(`列举结果里的分支出错：${listed.branch}`);
  if (listed.isMain) throw new Error("副本被标成了主检出");
  if (!afterCreate.some((entry) => entry.isMain && pathKey(entry.path) === pathKey(repo))) {
    throw new Error(`创建副本后主检出不在列举里：${JSON.stringify(afterCreate)}`);
  }

  // 删除：目录消失，列举不再包含它。
  await removeWorktree(repo, created.path);
  if (fs.existsSync(created.path)) throw new Error(`删除后目录仍然存在：${created.path}`);

  const afterRemove = await listWorktrees(repo);
  if (afterRemove.some((entry) => pathKey(entry.path) === pathKey(created.path))) {
    throw new Error(`删除后仍然列举得到：${JSON.stringify(afterRemove)}`);
  }
  if (afterRemove.length !== 1) throw new Error(`删除后应只剩主检出，实际：${JSON.stringify(afterRemove)}`);

  // 脏工作区：未提交文件必须让删除失败，且不静默删掉目录。
  const dirty = await addWorktree(repo, "feat/dirty-window");
  fs.writeFileSync(path.join(dirty.path, "untracked.txt"), "dirty\n");

  const message = await expectFailure("脏工作区的副本删除", () => removeWorktree(repo, dirty.path));
  if (!/modified or untracked files|is dirty|use --force/i.test(message)) {
    throw new Error(`脏工作区删除的报错不符合既有语义：${message}`);
  }
  if (!fs.existsSync(dirty.path)) throw new Error(`脏工作区被静默删掉了：${dirty.path}`);
  if (!(await listWorktrees(repo)).some((entry) => pathKey(entry.path) === pathKey(dirty.path))) {
    throw new Error("脏工作区的副本从列举里消失了");
  }

  await removeWorktree(repo, dirty.path, true);
  if (fs.existsSync(dirty.path)) throw new Error(`强制删除后目录仍然存在：${dirty.path}`);
}
