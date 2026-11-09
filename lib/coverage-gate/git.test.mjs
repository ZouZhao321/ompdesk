import assert from "node:assert/strict";
import test from "node:test";
import { isManagedSourceFile, parseChangedFiles } from "./git.ts";

test("受管源文件只收仓库代码，排除测试、脚本、test-support 与声明文件", () => {
  assert.equal(isManagedSourceFile("lib/ansi.ts"), true);
  assert.equal(isManagedSourceFile("app/page.tsx"), true);
  assert.equal(isManagedSourceFile("bin/ompdesk.js"), true);
  assert.equal(isManagedSourceFile("lib/ansi.test.mjs"), false);
  assert.equal(isManagedSourceFile("lib/spec/case.spec.ts"), false);
  assert.equal(isManagedSourceFile("test-support/agent-dir-sandbox.ts"), false);
  assert.equal(isManagedSourceFile("scripts/release.ts"), false);
  assert.equal(isManagedSourceFile("bin/web-auth-store.d.ts"), false);
  assert.equal(isManagedSourceFile("README.md"), false);
  assert.equal(isManagedSourceFile("app/globals.css"), false);
});

test("改动清单解析新增、修改与改名，删除不进清单", () => {
  const diff = ["M", "lib/a.ts", "A", "lib/b.ts", "R100", "lib/old.ts", "lib/new.ts", "D", "lib/gone.ts"].join("\0");

  assert.deepEqual(parseChangedFiles(diff), [
    { path: "lib/a.ts", status: "modified" },
    { path: "lib/b.ts", status: "added" },
    { path: "lib/new.ts", status: "renamed", previousPath: "lib/old.ts" },
  ]);
});

test("未跟踪文件按新增计入，已在差异里的路径不重复", () => {
  const diff = ["M", "lib/a.ts"].join("\0");
  const untracked = ["lib/c.ts", "lib/a.ts"].join("\0");

  assert.deepEqual(parseChangedFiles(diff, untracked), [
    { path: "lib/a.ts", status: "modified" },
    { path: "lib/c.ts", status: "added" },
  ]);
});

test("空输出得到空改动清单", () => {
  assert.deepEqual(parseChangedFiles(""), []);
});
