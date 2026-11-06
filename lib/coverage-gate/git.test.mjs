import assert from "node:assert/strict";
import test from "node:test";
import { isManagedSourceFile, isReferenceSourceFile } from "./git.ts";

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

test("生产引用来源包含 scripts/，仍排除测试与 test-support", () => {
  // 命令行脚本按路径调用，不使用 import 之外的入口，但确实用到了被测模块的导出。
  assert.equal(isReferenceSourceFile("scripts/coverage-gate.mjs"), true);
  assert.equal(isReferenceSourceFile("lib/git-env.ts"), true);
  assert.equal(isReferenceSourceFile("bin/ompdesk.js"), true);
  assert.equal(isReferenceSourceFile("lib/ansi.test.mjs"), false);
  assert.equal(isReferenceSourceFile("test-support/path-compare.ts"), false);
  assert.equal(isReferenceSourceFile("bin/web-auth-store.d.ts"), false);
});

// 改动清单的解析（改名、删除、未跟踪文件）由 git-repository.test.mjs 用真实仓库验证。
