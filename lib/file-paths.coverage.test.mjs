import assert from "node:assert/strict";
import test from "node:test";

const {
  encodeFilePathForApi,
  getFileApiUrl,
  getFileDirectory,
  getFileName,
  getRelativeFilePath,
  joinFilePath,
  normalizeFilePathSlashes,
} = await import("./file-paths.ts");

test("normalizes Windows and UNC separators only for absolute paths", () => {
  assert.equal(normalizeFilePathSlashes("C:\\work\\a b.png"), "C:/work/a b.png");
  assert.equal(normalizeFilePathSlashes("C:/work/a.png"), "C:/work/a.png");
  assert.equal(normalizeFilePathSlashes("\\\\server\\share\\x.md"), "//server/share/x.md");
  assert.equal(normalizeFilePathSlashes("/posix/path/x.md"), "/posix/path/x.md");
  assert.equal(normalizeFilePathSlashes("relative\\windows-style.md"), "relative\\windows-style.md");
  assert.equal(normalizeFilePathSlashes(""), "");
});

test("encodes each path segment and drops empty segments", () => {
  assert.equal(encodeFilePathForApi("/work//a b/x#y.png"), "work/a%20b/x%23y.png");
  assert.equal(encodeFilePathForApi("设计/文档?.md"), "%E8%AE%BE%E8%AE%A1/%E6%96%87%E6%A1%A3%3F.md");
  assert.equal(encodeFilePathForApi("C:\\work\\a%20b.png"), "C%3A/work/a%2520b.png");
  assert.equal(encodeFilePathForApi(""), "");
});

test("omits absent params and keeps zero-valued ones", () => {
  assert.equal(getFileApiUrl("/work/x.png", "meta"), "/api/files/work/x.png?type=meta");
  assert.equal(
    getFileApiUrl("/work/x.png", "watch", "", { width: 0, height: undefined }),
    "/api/files/work/x.png?type=watch&width=0",
  );
});

test("derives the file name from mixed separators and trailing slashes", () => {
  assert.equal(getFileName("C:\\work\\notes\\todo.md"), "todo.md");
  assert.equal(getFileName("/work/notes/"), "notes");
  assert.equal(getFileName("/"), "");
  assert.equal(getFileName("plain.md"), "plain.md");
});

test("derives the parent directory, including drive and root boundaries", () => {
  assert.equal(getFileDirectory("C:\\work\\notes\\todo.md"), "C:/work/notes");
  assert.equal(getFileDirectory("C:/todo.md"), "C:/");
  assert.equal(getFileDirectory("/todo.md"), "/");
  assert.equal(getFileDirectory("/work/notes/"), "/work");
  assert.equal(getFileDirectory("todo.md"), "");
});

test("returns a cwd-relative path only when the file is inside the cwd", () => {
  assert.equal(getRelativeFilePath("/work/project/src/a.ts", "/work/project"), "src/a.ts");
  assert.equal(getRelativeFilePath("/work/project/src/a.ts", "/work/project/"), "src/a.ts");
  assert.equal(getRelativeFilePath("C:\\work\\project\\src\\a.ts", "C:\\work\\project"), "src/a.ts");
  assert.equal(getRelativeFilePath("/work/other/a.ts", "/work/project"), "/work/other/a.ts");
  assert.equal(getRelativeFilePath("/work/project/src/a.ts"), "/work/project/src/a.ts");
  assert.equal(getRelativeFilePath("/work", "/work/project"), "/work");
});

test("joins a child path without doubling the separator", () => {
  assert.equal(joinFilePath("/work/project", "src/a.ts"), "/work/project/src/a.ts");
  assert.equal(joinFilePath("/work/project/", "src/a.ts"), "/work/project/src/a.ts");
  assert.equal(joinFilePath("C:\\work\\project", "src/a.ts"), "C:/work/project/src/a.ts");
});
