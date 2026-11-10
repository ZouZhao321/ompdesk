import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const { ensureWorktree, listWorktrees, removeWorktree, resolveProject } = await import("./worktree.ts");
const { createGitEnv } = await import("./git-env.ts");

const workRoot = path.join(process.cwd(), ".tmp", "lib-logic-two", "worktree");
const created = [];

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: createGitEnv(),
  });
}

function makeRepo() {
  fs.mkdirSync(workRoot, { recursive: true });
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(workRoot, "repo-")));
  created.push(root, `${root}-worktrees`);
  git(root, "init", "-q");
  git(root, "branch", "-M", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  fs.writeFileSync(path.join(root, "README.md"), "# fixture\n");
  git(root, "add", "README.md");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

test.after(() => {
  for (const entry of created) fs.rmSync(entry, { recursive: true, force: true });
});

test("removes a clean worktree and forgets its registration", async () => {
  const repo = makeRepo();
  git(repo, "branch", "feat/remove");
  const checkout = await ensureWorktree(repo, "feat/remove");
  assert.equal(fs.existsSync(checkout.path), true);

  await removeWorktree(repo, checkout.path);

  assert.equal(fs.existsSync(checkout.path), false);
  const remaining = await listWorktrees(repo);
  assert.equal(
    remaining.some((entry) => entry.path === checkout.path),
    false,
  );
});

test("surfaces the Git error for a dirty worktree and still allows a forced removal", async () => {
  const repo = makeRepo();
  git(repo, "branch", "feat/dirty");
  const checkout = await ensureWorktree(repo, "feat/dirty");
  fs.writeFileSync(path.join(checkout.path, "README.md"), "# changed\n");

  await assert.rejects(removeWorktree(repo, checkout.path), (error) => {
    assert.equal(error instanceof Error, true);
    assert.match(error.message, /modified|untracked|use --force/i);
    return true;
  });

  await removeWorktree(repo, checkout.path, true);
  assert.equal(fs.existsSync(checkout.path), false);
});

test("rejects unknown paths and the main checkout", async () => {
  const repo = makeRepo();

  await assert.rejects(removeWorktree(repo, path.join(repo, "not-a-worktree")), /Not a worktree of this repository/);
  await assert.rejects(removeWorktree(repo, repo), /Cannot remove the main worktree/);
});

test("groups a vanished managed worktree back under its main repository", async () => {
  const repo = makeRepo();
  const ghost = path.join(`${repo}-worktrees`, "gone-branch");

  const info = await resolveProject(ghost);

  assert.deepEqual(info, {
    projectRoot: repo,
    branch: "gone-branch",
    isWorktree: true,
    isTopLevel: true,
  });
});

test("leaves a vanished plain directory as its own project", async () => {
  const ghost = path.join(workRoot, "plain-missing-directory");
  const info = await resolveProject(ghost);

  assert.deepEqual(info, { projectRoot: ghost, branch: null, isWorktree: false, isTopLevel: false });
});
