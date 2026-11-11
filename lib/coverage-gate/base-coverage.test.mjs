import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createGitEnv } from "../git-env.ts";
import { generateBaseCoverage, readSourcePair } from "./base-coverage.ts";

/**
 * 基准获取的集成测试。现场建一个临时仓库，用一条只含单个用例的测试命令产生 lcov：
 * 不跑本仓库的整套测试，也不读写本仓库的工作区。
 */

const VALUE_SOURCE = "export function add(a: number, b: number) {\n  return a + b;\n}\n";
const VALUE_TEST = [
  'import { expect, test } from "bun:test";',
  'import { add } from "./value.ts";',
  'test("add", () => {',
  "  expect(add(1, 2)).toBe(3);",
  "});",
].join("\n");

const repositories = [];

function git(cwd, args) {
  execFileSync(
    "git",
    [
      "-C",
      cwd,
      "-c",
      "user.name=Coverage Gate",
      "-c",
      "user.email=gate@example.com",
      // 本机可能配了全局 hooksPath，临时仓库会因此继承 pre-commit 钩子并让提交失败。
      "-c",
      "core.hooksPath=",
      ...args,
    ],
    { stdio: "pipe", env: createGitEnv(), windowsHide: true },
  );
}

function createRepository() {
  const root = mkdtempSync(path.join(tmpdir(), "coverage-base-"));
  repositories.push(root);
  execFileSync("git", ["init", "-q", root], { stdio: "pipe", env: createGitEnv(), windowsHide: true });
  // 全局提交签名与全局钩子都会被临时仓库继承；钩子还会被被测代码的 git worktree add 触发，
  // 所以必须在仓库级关掉，不能只靠测试自己的 git 包装传 -c。
  git(root, ["config", "commit.gpgsign", "false"]);
  git(root, ["config", "core.hooksPath", ""]);
  mkdirSync(path.join(root, "lib"), { recursive: true });
  writeFileSync(path.join(root, "lib/value.ts"), VALUE_SOURCE);
  writeFileSync(path.join(root, "lib/value.test.ts"), VALUE_TEST);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "init"]);
  return root;
}

function headOf(root) {
  return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
    env: createGitEnv(),
    windowsHide: true,
  }).trim();
}

test.after(() => {
  for (const root of repositories) rmSync(root, { recursive: true, force: true });
});

test("分叉点的基准覆盖率现场生成，跑完删掉工作副本", async () => {
  const root = createRepository();
  const scratchRoot = path.join(root, ".tmp", "coverage-gate-base");

  const result = await generateBaseCoverage({ repositoryRoot: root, mergeBase: headOf(root), scratchRoot });

  assert.equal(result.ok, true);
  const coverage = result.coverage.get("lib/value.ts");
  assert.equal(coverage?.functionsFound, 1);
  assert.equal(coverage?.functionsHit, 1);
  assert.ok(result.durationMs > 0);
  assert.deepEqual(readdirSync(scratchRoot), []);
});

test("分叉点提交不存在时说明是工作副本创建失败", async () => {
  const root = createRepository();

  const result = await generateBaseCoverage({
    repositoryRoot: root,
    mergeBase: "0000000000000000000000000000000000000000",
    scratchRoot: path.join(root, ".tmp", "coverage-gate-base"),
  });

  assert.equal(result.ok, false);
  assert.match(result.detail, /无法为分叉点 0000000 创建工作副本/);
});

test("分叉点上的测试失败时不产出覆盖率，原因写进结果", async () => {
  const root = createRepository();
  writeFileSync(
    path.join(root, "lib/broken.test.ts"),
    'import { expect, test } from "bun:test";\ntest("broken", () => { expect(1).toBe(2); });\n',
  );
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "broken"]);

  const result = await generateBaseCoverage({
    repositoryRoot: root,
    mergeBase: headOf(root),
    scratchRoot: path.join(root, ".tmp", "coverage-gate-base"),
  });

  assert.equal(result.ok, false);
  assert.match(result.detail, /的测试运行失败/);
});

test("两版正文分别取分叉点版本与工作区版本", async () => {
  const root = createRepository();
  const mergeBase = headOf(root);
  writeFileSync(path.join(root, "lib/value.ts"), `${VALUE_SOURCE}// 本地改动\n`);

  const pair = await readSourcePair(root, mergeBase, { path: "lib/value.ts", status: "modified" });

  assert.equal(pair.base, VALUE_SOURCE);
  assert.match(pair.head, /本地改动/);
});

test("分叉点里不存在的路径按空内容处理", async () => {
  const root = createRepository();

  const pair = await readSourcePair(root, headOf(root), { path: "lib/absent.ts", status: "added" });

  assert.deepEqual(pair, { base: null, head: null });
});

test("工作副本目录建不出来时返回失败结果而不是抛出", async () => {
  const root = createRepository();
  const blocker = path.join(root, ".tmp", "blocked");
  mkdirSync(path.dirname(blocker), { recursive: true });
  writeFileSync(blocker, "");

  const result = await generateBaseCoverage({
    repositoryRoot: root,
    mergeBase: headOf(root),
    scratchRoot: path.join(blocker, "coverage-gate-base"),
  });

  assert.equal(result.ok, false);
  assert.match(result.detail, /无法创建工作副本目录/);
});

test("本次版本正文读不到时按缺席处理，不抛异常", async () => {
  const root = createRepository();
  mkdirSync(path.join(root, "lib/dir.ts"));

  const pair = await readSourcePair(root, headOf(root), { path: "lib/dir.ts", status: "added" });

  assert.deepEqual(pair, { base: null, head: null });
});
