import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  extractCommentEntries,
  isCommentSourceFile,
  isSkippedCommentSourceDir,
} = await jiti.import("./comment-entries.ts");

function entry(text, overrides = {}) {
  return {
    filePath: "src/a.ts",
    startLine: 1,
    endLine: 1,
    text,
    language: "zh",
    ...overrides,
  };
}

test("merges consecutive line comments into one entry", () => {
  const result = extractCommentEntries([{
    path: "src/a.ts",
    content: "const a = 1;\n// 第一行\n//   第二行\nconst b = 2;\n",
  }]);

  assert.deepEqual(result.entries, [{
    filePath: "src/a.ts",
    startLine: 2,
    endLine: 3,
    text: "第一行 第二行",
    language: "zh",
  }]);
  assert.equal(result.excluded, 0);
});

test("treats each block comment as a single entry", () => {
  const content = [
    "/**",
    " * 解析配置",
    " * 并返回结果",
    " */",
    "/* Single line block */",
  ].join("\n");

  const result = extractCommentEntries([{ path: "src/a.ts", content }]);

  assert.deepEqual(result.entries, [
    entry("解析配置 并返回结果", { startLine: 1, endLine: 4 }),
    entry("Single line block", { startLine: 5, endLine: 5, language: "en" }),
  ]);
  assert.equal(result.excluded, 0);
});

test("excludes symbol banners and single-word titles but counts them", () => {
  const content = [
    "/* ---------- */",
    "const a = 1;",
    "// Utilities",
    "const b = 2;",
    "// ===== Section =====",
    "const c = 3;",
    "// 这是一个说明",
  ].join("\n");

  const result = extractCommentEntries([{ path: "src/a.ts", content }]);

  assert.deepEqual(result.entries, [entry("这是一个说明", { startLine: 7, endLine: 7 })]);
  assert.equal(result.excluded, 3);
});

test("normalization ignores indentation and comment decoration", () => {
  const plain = extractCommentEntries([{
    path: "src/a.ts",
    content: "// 说明文字\n",
  }]);
  const indented = extractCommentEntries([{
    path: "src/a.ts",
    content: "      //     说明文字\n",
  }]);
  const block = extractCommentEntries([{
    path: "src/a.ts",
    content: "/**\n   *    说明文字\n   */\n",
  }]);

  assert.deepEqual(plain.entries.map((e) => e.text), ["说明文字"]);
  assert.deepEqual(indented.entries.map((e) => e.text), plain.entries.map((e) => e.text));
  assert.deepEqual(block.entries.map((e) => e.text), plain.entries.map((e) => e.text));
});

test("sorts entries by path code units and then by line, deterministically", () => {
  const files = [
    { path: "src/a.ts", content: "// 第二个文件\n" },
    { path: "src/Z.ts", content: "// 大写路径\n" },
    { path: "src/a.tsx", content: "// tsx 文件\n// 同文件下一段\n" },
  ];

  const first = extractCommentEntries(files);
  const second = extractCommentEntries(files);

  assert.deepEqual(first, second);
  assert.deepEqual(first.entries.map((e) => [e.filePath, e.startLine]), [
    ["src/Z.ts", 1],
    ["src/a.ts", 1],
    ["src/a.tsx", 1],
  ]);
});

test("ignores comment markers inside string and template literals", () => {
  const content = [
    "const url = \"https://example.com\"; // 真实注释",
    "const text = `第一行",
    "// 不是注释",
    "最后一行`;",
    "// 结尾注释",
  ].join("\n");

  const result = extractCommentEntries([{ path: "src/a.ts", content }]);

  assert.deepEqual(result.entries.map((e) => [e.text, e.startLine]), [
    ["真实注释", 1],
    ["结尾注释", 5],
  ]);
});

test("classifies entries by the script that dominates the text", () => {
  const content = [
    "// 中文说明占多数",
    "const a = 1;",
    "// mostly English explanation",
  ].join("\n");

  const result = extractCommentEntries([{ path: "src/a.ts", content }]);

  assert.deepEqual(result.entries.map((e) => [e.text, e.language]), [
    ["中文说明占多数", "zh"],
    ["mostly English explanation", "en"],
  ]);
});

test("scans only TypeScript sources outside dependency, build and scratch dirs", () => {
  assert.equal(isCommentSourceFile("src/a.ts"), true);
  assert.equal(isCommentSourceFile("src\\nested\\a.tsx"), true);
  assert.equal(isCommentSourceFile("src/node_modules.ts"), true);

  assert.equal(isCommentSourceFile("src/a.js"), false);
  assert.equal(isCommentSourceFile("README.md"), false);
  assert.equal(isCommentSourceFile("src/theme.css"), false);
  assert.equal(isCommentSourceFile("package.json"), false);

  assert.equal(isCommentSourceFile("node_modules/pkg/index.ts"), false);
  assert.equal(isCommentSourceFile("dist/index.ts"), false);
  assert.equal(isCommentSourceFile(".next/types.ts"), false);
  assert.equal(isCommentSourceFile(".worktrees/t81/src/a.ts"), false);
  assert.equal(isCommentSourceFile(".tmp/t81/a.ts"), false);

  assert.equal(isSkippedCommentSourceDir("node_modules"), true);
  assert.equal(isSkippedCommentSourceDir(".worktrees"), true);
  assert.equal(isSkippedCommentSourceDir(".tmp"), true);
  assert.equal(isSkippedCommentSourceDir("src"), false);
});
