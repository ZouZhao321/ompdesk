import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { resolveDistDir } = require("./runtime.js");

test("resolveDistDir keeps every version on its own build directory", () => {
  // 安装只会覆盖新包里的文件，共用目录就意味着上一版服务端写下的路由缓存会被
  // 这一版读到并当作自己的预渲染结果返回。
  assert.notEqual(resolveDistDir("1.0.27"), resolveDistDir("1.0.28"));
  assert.notEqual(resolveDistDir("1.0.28"), ".next");
});

test("resolveDistDir names the directory after the version", () => {
  assert.equal(resolveDistDir("1.0.28"), ".next-v1.0.28");
});

test("resolveDistDir honours an explicit directory", () => {
  assert.equal(resolveDistDir("1.0.28", ".next-smoke"), ".next-smoke");
});

test("resolveDistDir ignores a blank override", () => {
  assert.equal(resolveDistDir("1.0.28", "   "), ".next-v1.0.28");
});
