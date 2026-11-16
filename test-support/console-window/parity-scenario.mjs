/**
 * 场景：成对快照。
 *
 * 同一批命令分别在「启动入口补上隐藏控制台」与「不执行启动入口」两种模式下各跑一次，
 * 把结果归一化成快照写出。两次快照必须完全一致：隐藏窗口只能改变窗口，不得改变命令语义。
 */
import fs from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";

export async function run() {
  const snapshotFile = process.env.OMPDESK_PARITY_SNAPSHOT;
  const fixture = process.env.OMPDESK_CONSOLE_SCENARIO_CWD;
  if (!snapshotFile || !fixture) throw new Error("缺少 OMPDESK_PARITY_SNAPSHOT 或 OMPDESK_CONSOLE_SCENARIO_CWD");

  const root = path.join(import.meta.dir, "..", "..");
  const jiti = createJiti(import.meta.url);
  const { getGitStatus, getGitFileDiff } = await jiti.import(path.join(root, "lib", "git-changes.ts"));
  const { listWorktrees } = await jiti.import(path.join(root, "lib", "worktree.ts"));
  const { listGitFiles } = await jiti.import(path.join(root, "lib", "git-listing.ts"));
  const { checkIgnoredEntries } = await jiti.import(path.join(root, "lib", "git-ignore.ts"));
  const { runNpx } = await jiti.import(path.join(root, "lib", "npx.ts"));

  /** 夹具路径换成占位符，两次运行的差异才有意义。 */
  const normalize = (value) => String(value).split(fixture).join("<fixture>").split(path.sep).join("/");

  const status = await getGitStatus(fixture);
  const diff = await getGitFileDiff(fixture, path.join(fixture, "modified.txt"));
  const worktrees = await listWorktrees(fixture);
  const files = await listGitFiles(fixture);
  const ignored = await checkIgnoredEntries(fixture, ["ignored.txt", "plain.txt"]);
  const npx = await runNpx(["--version"], { timeout: 60_000 });

  const snapshot = {
    git: {
      isGitRepository: status.isGitRepository,
      files: status.files.map((file) => ({ path: normalize(file.filePath), status: file.status, code: file.code })),
      additions: status.additions,
      deletions: status.deletions,
    },
    diff: {
      supported: diff.supported,
      status: diff.status ?? null,
      patch: (diff.patch ?? "").split("\r\n").join("\n"),
    },
    worktrees: worktrees.map((worktree) => ({ path: normalize(worktree.path), isMain: worktree.isMain })),
    files: (files ?? []).map(normalize).sort(),
    ignored: [...(ignored ?? [])].sort(),
    npx: { exitCode: npx ? 0 : 1, version: npx.stdout.trim() },
  };

  fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));
}
