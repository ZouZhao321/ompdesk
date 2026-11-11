import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createGitEnv } from "../git-env.ts";
import {
  listChangedFiles,
  listDeletedFiles,
  listFilesAtRevision,
  listManagedSourceFiles,
  listReferenceSourceFiles,
  listTestFiles,
  readFileAtRevision,
  repositoryRoot,
  resolveMergeBase,
} from "./git.ts";

/** 仓库查询的默认实现直接调 git；这里用真实仓库验证，不桩掉子进程。 */
function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, env: createGitEnv(), encoding: "utf8", stdio: "pipe", windowsHide: true });
}

function writeFile(root, relative, text) {
  const full = path.join(root, relative);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text);
}

function commitAll(root, message) {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
}

function createRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "ompdesk-git-query-"));
  git(root, "init", "-q");
  git(root, "symbolic-ref", "HEAD", "refs/heads/main");
  git(root, "config", "user.name", "Gate Test");
  git(root, "config", "user.email", "gate@example.invalid");
  git(root, "config", "commit.gpgsign", "false");
  git(root, "config", "core.autocrlf", "false");
  // 改名识别在部分环境里被全局配置关掉；这里固定成默认行为，断言不依赖本机设置。
  git(root, "config", "diff.renames", "true");
  return root;
}

test("仓库根、分叉点与受管/测试文件清单取自真实仓库", async () => {
  const root = createRepo();
  try {
    writeFile(root, "lib/a.ts", "export const a = 1;\n");
    writeFile(root, "lib/a.test.mjs", "// 测试文件\n");
    writeFile(root, "scripts/tool.mjs", "// 命令行脚本\n");
    writeFile(root, "README.md", "# readme\n");
    writeFile(root, "app/page.tsx", "export default function Page() {}\n");
    commitAll(root, "base");
    const base = git(root, "rev-parse", "HEAD").trim();
    git(root, "branch", "forked");
    writeFile(root, "docs.txt", "x\n");
    commitAll(root, "second");

    // Windows 上 mkdtemp 可能落在 8.3 短名目录（RUNNER~1），git 返回长名；
    // 两边都用系统 realpath 归一后再比较。
    const canonical = (value) => realpathSync.native(value).toLowerCase();
    assert.equal(canonical(await repositoryRoot(root)), canonical(root));
    assert.equal(await resolveMergeBase(root, "forked"), base);
    assert.deepEqual(await listManagedSourceFiles(root), ["app/page.tsx", "lib/a.ts"]);
    // 生产引用来源把 scripts/ 也算进来：脚本用 import 使用被测模块的导出。
    assert.deepEqual(await listReferenceSourceFiles(root), ["app/page.tsx", "lib/a.ts", "scripts/tool.mjs"]);
    assert.deepEqual(await listTestFiles(root), ["lib/a.test.mjs"]);
    assert.deepEqual(await listFilesAtRevision(root, base), [
      "README.md",
      "app/page.tsx",
      "lib/a.test.mjs",
      "lib/a.ts",
      "scripts/tool.mjs",
    ]);
    assert.equal(await readFileAtRevision(root, base, "lib/a.ts"), "export const a = 1;\n");
    // 该版本里不存在的路径按空内容处理，新增与删除都走这条。
    assert.equal(await readFileAtRevision(root, base, "lib/missing.ts"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("改动清单区分修改、新增、改名，删除单独列出", async () => {
  const root = createRepo();
  try {
    writeFile(root, "lib/keep.ts", "export const keep = 1;\n");
    writeFile(root, "lib/moved.ts", "export function moved() {}\n");
    writeFile(root, "lib/gone.ts", "export function gone() {}\n");
    commitAll(root, "base");
    const base = git(root, "rev-parse", "HEAD").trim();

    git(root, "mv", "lib/moved.ts", "lib/renamed.ts");
    unlinkSync(path.join(root, "lib/gone.ts"));
    writeFile(root, "lib/keep.ts", "export const keep = 2;\n");
    writeFile(root, "lib/untracked.ts", "export const fresh = 1;\n");

    assert.deepEqual(await listChangedFiles(root, base), [
      { path: "lib/keep.ts", status: "modified" },
      { path: "lib/renamed.ts", status: "renamed", previousPath: "lib/moved.ts" },
      { path: "lib/untracked.ts", status: "added" },
    ]);
    assert.deepEqual(await listDeletedFiles(root, base), ["lib/gone.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
