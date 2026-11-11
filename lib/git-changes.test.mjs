import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import test from "node:test";
import { createGitEnv } from "./git-env.ts";

async function loadSubject() {
  return import("./git-status.ts");
}

test("parses null-delimited Git status entries including renames", async () => {
  const { parseGitPorcelainV1 } = await loadSubject();
  const entries = parseGitPorcelainV1(
    [" M components/App.tsx", "?? notes.txt", "R  src/new-name.ts", "src/old-name.ts", ""].join("\0"),
  );

  assert.deepEqual(entries, [
    {
      path: "components/App.tsx",
      indexStatus: " ",
      worktreeStatus: "M",
    },
    {
      path: "notes.txt",
      indexStatus: "?",
      worktreeStatus: "?",
    },
    {
      path: "src/new-name.ts",
      originalPath: "src/old-name.ts",
      indexStatus: "R",
      worktreeStatus: " ",
    },
  ]);
});

test("classifies Git status for explorer badges", async () => {
  const { classifyGitStatus } = await loadSubject();
  const classify = (pair) =>
    classifyGitStatus({
      path: "file.ts",
      indexStatus: pair[0],
      worktreeStatus: pair[1],
    });

  assert.deepEqual(classify(" M"), { status: "modified", code: "M" });
  assert.deepEqual(classify("??"), { status: "untracked", code: "U" });
  assert.deepEqual(classify("A "), { status: "added", code: "A" });
  assert.deepEqual(classify("R "), { status: "renamed", code: "R" });
  assert.deepEqual(classify("UU"), { status: "conflict", code: "C" });
  assert.deepEqual(classify(" D"), { status: "deleted", code: "D" });
});

/**
 * 临时仓库：目录自建、提交一条文件，测试之间不共享状态。钩子注入的 `GIT_DIR` 会盖过
 * `git -C`，每个命令都带 `createGitEnv()`。
 */
function createRepository() {
  const root = mkdtempSync(join(tmpdir(), "ompdesk-git-changes-"));
  const run = (...args) => execFileSync("git", ["-C", root, ...args], { env: createGitEnv(), stdio: "pipe" });
  run("init", "-q");
  run("config", "user.email", "ompdesk@example.com");
  run("config", "user.name", "ompdesk test");
  run("config", "commit.gpgsign", "false");
  run("config", "core.autocrlf", "false");
  writeFileSync(join(root, "tracked.txt"), "first\n");
  run("add", "tracked.txt");
  run("commit", "-q", "-m", "init");
  return { root, run };
}

test("非 git 目录返回 isGitRepository: false", async () => {
  const { getGitStatus } = await import("./git-changes.ts");
  const dir = mkdtempSync(join(tmpdir(), "ompdesk-git-changes-plain-"));
  try {
    assert.deepEqual(await getGitStatus(dir), {
      isGitRepository: false,
      repositoryRoot: null,
      files: [],
      additions: 0,
      deletions: 0,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("列出改动与未跟踪文件并统计新增行数", async () => {
  const { getGitStatus } = await import("./git-changes.ts");
  const { root } = createRepository();
  try {
    writeFileSync(join(root, "tracked.txt"), "first\nsecond\n");
    writeFileSync(join(root, "untracked.txt"), "one\ntwo\n");

    // 临时目录在 Windows 上可能带 8.3 短名，git 报告的是长名；先用 realpath 归一，
    // 否则按前缀判定的路径过滤会把两条记录都丢掉。
    const canonical = realpathSync.native(root);
    const status = await getGitStatus(canonical);

    assert.equal(status.isGitRepository, true);
    assert.equal(realpathSync.native(status.repositoryRoot), canonical);
    const byName = new Map(status.files.map((file) => [path.basename(file.filePath), file]));
    assert.equal(byName.get("tracked.txt").status, "modified");
    assert.equal(byName.get("untracked.txt").status, "untracked");
    assert.equal(status.additions, 3);
    assert.equal(status.deletions, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
