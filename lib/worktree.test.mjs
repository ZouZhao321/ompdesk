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

// worktree.useRelativePaths 自 git 2.48 起生效；旧版本会静默忽略该配置。
const GIT_SUPPORTS_RELATIVE_WORKTREES = (() => {
  const match = /(\d+)\.(\d+)/.exec(
    execFileSync("git", ["--version"], { encoding: "utf8", env: createGitEnv(), windowsHide: true }),
  );
  return match ? Number(match[1]) * 1000 + Number(match[2]) >= 2048 : false;
})();

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
  // 本机可能配了全局钩子与提交签名，临时仓库照用会建不出提交。
  git(root, "config", "core.hooksPath", "");
  git(root, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(root, "README.md"), "# fixture\n");
  git(root, "add", "README.md");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

function git(cwd, ...args) {
  // git 钩子会注入 GIT_DIR 等仓库定位变量，盖过 -C；测试自建仓库前先摘掉。
  execFileSync("git", ["-C", cwd, ...args], {
    stdio: ["ignore", "ignore", "pipe"],
    env: createGitEnv(),
    windowsHide: true,
  });
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

  assert.deepEqual(
    branches.map((branch) => branch.name),
    ["main", "release"],
  );
});

// 跳过必须给在注册选项上：Bun 的 node:test 实现里 t.skip() 抛 NotImplementedError。
test(
  "写法不同的同一目录仍被认成顶层",
  { skip: process.platform === "win32" ? false : "只在 Windows 上区分正斜杠与大小写" },
  async (t) => {
    const repo = makeRepo(t);

    const forward = await resolveProject(repo.replace(/\\/g, "/"));
    const upper = await resolveProject(repo.toUpperCase());

    assert.equal(forward.isTopLevel, true);
    assert.equal(upper.isTopLevel, true);
  },
);

test("分支在列表读完后消失时报错，不静默新建", async (t) => {
  const repo = makeRepo(t);

  await assert.rejects(() => ensureWorktree(repo, "feat/gone"), /no longer exists/);
  assert.deepEqual(siblingDirNames(repo), []);
});

test("显式创建时允许为不存在的分支建副本", async (t) => {
  const repo = makeRepo(t);

  const result = await ensureWorktree(repo, "feat/new", { createBranch: true });

  assert.equal(result.reused, false);
  assert.equal(result.path, checkoutDir(repo, "feat-new"));
  assert.ok((await listBranches(repo)).some((branch) => branch.name === "feat/new"));
});

test("清理失效登记只动当前分支那一条", async (t) => {
  const repo = makeRepo(t);
  git(repo, "branch", "feat/a");
  git(repo, "branch", "feat/b");
  const first = await ensureWorktree(repo, "feat/a");
  const other = await ensureWorktree(repo, "feat/b");
  fs.rmSync(first.path, { recursive: true, force: true });
  fs.rmSync(other.path, { recursive: true, force: true });

  const again = await ensureWorktree(repo, "feat/a");

  assert.equal(again.path, checkoutDir(repo, "feat-a"));
  const adminRoot = path.join(repo, ".git", "worktrees");
  const recorded = fs
    .readdirSync(adminRoot)
    .map((entry) => fs.readFileSync(path.join(adminRoot, entry, "gitdir"), "utf8").trim());
  assert.ok(
    recorded.some((gitdir) => gitdir.includes("feat-b")),
    "其它分支的失效登记必须保留",
  );
});

test("锁定的副本不当作失效登记清理", async (t) => {
  const repo = makeRepo(t);
  git(repo, "branch", "feat/locked");
  const created = await ensureWorktree(repo, "feat/locked");
  git(repo, "worktree", "lock", created.path);
  fs.rmSync(created.path, { recursive: true, force: true });

  await assert.rejects(() => ensureWorktree(repo, "feat/locked"), /locked/);
});

test("目录仍在但登记损坏时报错，不另建副本", async (t) => {
  const repo = makeRepo(t);
  git(repo, "branch", "feat/broken");
  const created = await ensureWorktree(repo, "feat/broken");
  fs.rmSync(path.join(created.path, ".git"), { force: true });

  await assert.rejects(() => ensureWorktree(repo, "feat/broken"), /registration is broken/);
  assert.deepEqual(siblingDirNames(repo), ["feat-broken"]);
});

test("没有副本的分支在清单里没有检出路径", async (t) => {
  const repo = makeRepo(t);
  git(repo, "branch", "feat/none");

  const branches = await listBranches(repo);

  assert.equal(branches.find((branch) => branch.name === "feat/none")?.worktreePath, null);
});

test("副本目录连同父目录删除后仍能重建", async (t) => {
  const repo = makeRepo(t);
  git(repo, "branch", "feat/gone-dir");
  const created = await ensureWorktree(repo, "feat/gone-dir");
  fs.rmSync(`${repo}-worktrees`, { recursive: true, force: true });

  const again = await ensureWorktree(repo, "feat/gone-dir");

  assert.equal(again.reused, false);
  assert.equal(again.path, created.path);
});

test(
  "开启相对 gitdir 时仍能清掉失效登记",
  { skip: GIT_SUPPORTS_RELATIVE_WORKTREES ? false : "git 不支持 worktree.useRelativePaths" },
  async (t) => {
    const repo = makeRepo(t);
    git(repo, "config", "worktree.useRelativePaths", "true");
    git(repo, "branch", "feat/rel");
    const created = await ensureWorktree(repo, "feat/rel");
    const adminRoot = path.join(repo, ".git", "worktrees");
    const recorded = fs
      .readdirSync(adminRoot)
      .map((entry) => fs.readFileSync(path.join(adminRoot, entry, "gitdir"), "utf8").trim());
    assert.ok(
      recorded.some((value) => value.length > 0 && !path.isAbsolute(value)),
      "git 应写入相对 gitdir",
    );
    fs.rmSync(created.path, { recursive: true, force: true });

    const again = await ensureWorktree(repo, "feat/rel");

    assert.equal(again.reused, false);
    assert.equal(again.path, created.path);
  },
);

test("本工具目录之外的失效副本保留登记并报错", async (t) => {
  const repo = makeRepo(t);
  const external = `${repo}-external`;
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  git(repo, "branch", "feat/ext");
  git(repo, "worktree", "add", "-q", external, "feat/ext");
  fs.rmSync(external, { recursive: true, force: true });

  await assert.rejects(() => ensureWorktree(repo, "feat/ext"), /unreachable/);
});
