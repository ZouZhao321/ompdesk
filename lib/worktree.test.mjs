import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { ensureWorktree, listBranches, listWorktrees, resolveProject } = await jiti.import("./worktree.ts");
const { createGitEnv } = await jiti.import("./git-env.ts");

/** 临时仓库加一个空提交；副本目录落在它同级的 `<repo>-worktrees`，一并清掉。 */
function makeRepo(t) {
    // git 打印的是 realpath（macOS 上 /var 会变成 /private/var），夹具目录先归一。
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-worktree-")));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(`${root}-worktrees`, { recursive: true, force: true });
  });
  git(root, "init", "-q");
  git(root, "branch", "-M", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  fs.writeFileSync(path.join(root, "README.md"), "# fixture\n");
  git(root, "add", "README.md");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

function git(cwd, ...args) {
  // git 钩子会注入 GIT_DIR 等仓库定位变量，盖过 -C；测试自建仓库前先摘掉。
  execFileSync("git", ["-C", cwd, ...args], { stdio: ["ignore", "ignore", "pipe"], env: createGitEnv() });
}

function checkoutDir(repoRoot, name) {
  return path.join(`${repoRoot}-worktrees`, name);
}

function siblingDirNames(repoRoot) {
  const base = `${repoRoot}-worktrees`;
  return fs.existsSync(base) ? fs.readdirSync(base).sort() : [];
}

test("分支清单标出占用它的副本与当前分支", async (t) => {
  const repo = makeRepo(t);
  git(repo, "branch", "feat/a");
  const holder = checkoutDir(repo, "feat-a");
  git(repo, "worktree", "add", "-q", holder, "feat/a");

  const branches = await listBranches(repo);
  const feat = branches.find((branch) => branch.name === "feat/a");
  const main = branches.find((branch) => branch.name === "main");

  assert.equal(feat.worktreePath, holder);
  assert.equal(feat.current, false);
  assert.equal(main.worktreePath, repo);
  assert.equal(main.current, true);
});

test("分支已有副本时直接复用，不新建目录", async (t) => {
  const repo = makeRepo(t);
  git(repo, "branch", "feat/a");
  git(repo, "worktree", "add", "-q", checkoutDir(repo, "feat-a"), "feat/a");
  const before = siblingDirNames(repo);

  const result = await ensureWorktree(repo, "feat/a");

  assert.equal(result.reused, true);
  assert.equal(result.path, checkoutDir(repo, "feat-a"));
  assert.deepEqual(siblingDirNames(repo), before);
});

test("没有副本时建一份，第二次请求复用同一目录", async (t) => {
  const repo = makeRepo(t);
  git(repo, "branch", "feat/b");

  const first = await ensureWorktree(repo, "feat/b");
  const second = await ensureWorktree(repo, "feat/b");

  assert.equal(first.reused, false);
  assert.equal(first.path, checkoutDir(repo, "feat-b"));
  assert.equal(second.reused, true);
  assert.equal(second.path, first.path);
  assert.deepEqual(siblingDirNames(repo), ["feat-b"]);
});

test("压平后同名的两条分支各占一个目录，后者加序号后缀", async (t) => {
  const repo = makeRepo(t);
  git(repo, "branch", "feat/a");
  git(repo, "branch", "feat-a");

  const slash = await ensureWorktree(repo, "feat/a");
  const dash = await ensureWorktree(repo, "feat-a");

  assert.equal(slash.path, checkoutDir(repo, "feat-a"));
  assert.equal(dash.path, checkoutDir(repo, "feat-a-2"));
  assert.equal(dash.reused, false);
  assert.deepEqual(siblingDirNames(repo), ["feat-a", "feat-a-2"]);
});

test("副本目录消失后先清理失效登记，再按没有副本重建", async (t) => {
  const repo = makeRepo(t);
  git(repo, "branch", "feat/c");
  const created = await ensureWorktree(repo, "feat/c");
  fs.rmSync(created.path, { recursive: true, force: true });

  const again = await ensureWorktree(repo, "feat/c");

  assert.equal(again.reused, false);
  assert.equal(again.path, checkoutDir(repo, "feat-c"));
  assert.deepEqual(siblingDirNames(repo), ["feat-c"]);
  const branches = await listBranches(repo);
  assert.equal(branches.find((branch) => branch.name === "feat/c").worktreePath, again.path);
  assert.equal((await listWorktrees(repo)).length, 2);
});

test("仓库顶层被认成顶层目录，切换器才有显示条件", async (t) => {
  const repo = makeRepo(t);

  const info = await resolveProject(repo);

  assert.equal(info.isTopLevel, true);
  assert.equal(info.isWorktree, false);
  assert.equal(info.projectRoot, repo);
});

test("分支与 tag 同名时仍按分支名列出", async (t) => {
    const repo = makeRepo(t);
    git(repo, "branch", "release");
    git(repo, "tag", "release");

    const branches = await listBranches(repo);

    assert.deepEqual(branches.map((branch) => branch.name), ["main", "release"]);
});

test("写法不同的同一目录仍被认成顶层", async (t) => {
    if (process.platform !== "win32") {
        t.skip("只在 Windows 上区分正斜杠与大小写");
        return;
    }
    const repo = makeRepo(t);

    const forward = await resolveProject(repo.replace(/\\/g, "/"));
    const upper = await resolveProject(repo.toUpperCase());

    assert.equal(forward.isTopLevel, true);
    assert.equal(upper.isTopLevel, true);
});

test("分支在列表读完后消失时报错，不静默新建", async (t) => {
    const repo = makeRepo(t);

    await assert.rejects(() => ensureWorktree(repo, "feat/gone"), /no longer exists/);
    assert.deepEqual(siblingDirNames(repo), []);
});
