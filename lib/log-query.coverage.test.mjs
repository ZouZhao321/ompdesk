import assert from "node:assert/strict";
import realFs from "node:fs";
import { mock } from "bun:test";
import path from "node:path";
import test from "node:test";

const state = { failReadSync: false, failReadFileSync: false };

function enoent() {
  const error = new Error("ENOENT: the file rotated away");
  error.code = "ENOENT";
  return error;
}

mock.module("node:fs", () => ({
  ...realFs,
  readSync: (...args) => {
    if (state.failReadSync) throw enoent();
    return realFs.readSync(...args);
  },
  readFileSync: (...args) => {
    if (state.failReadFileSync) throw enoent();
    return realFs.readFileSync(...args);
  },
}));

const { LogQueryError, readLogDownload, readLogPage } = await import("./log-query.ts");
mock.restore();

const root = process.cwd();
const workDir = path.join(root, ".tmp", "lib-logic-two", "log-query");
realFs.mkdirSync(workDir, { recursive: true });
const fileName = `omp.2026-01-01.${process.pid}.log`;
realFs.writeFileSync(path.join(workDir, fileName), '{"level":"info","message":"first"}\n');

test.after(() => {
  realFs.rmSync(workDir, { recursive: true, force: true });
});

test("maps a file that disappears before the fingerprint to a retryable 404", () => {
  state.failReadSync = true;
  try {
    assert.throws(
      () => readLogPage({ directory: workDir, file: fileName, pid: process.pid }),
      (error) => error instanceof LogQueryError && error.status === 404 && error.message === "Log file not found",
    );
  } finally {
    state.failReadSync = false;
  }
});

test("maps a download that loses the file to a retryable 404", () => {
  state.failReadFileSync = true;
  try {
    assert.throws(
      () => readLogDownload(fileName, { directory: workDir, pid: process.pid }),
      (error) => error instanceof LogQueryError && error.status === 404 && error.message === "Log file not found",
    );
  } finally {
    state.failReadFileSync = false;
  }
});

test("reads the same file normally when nothing disappears", () => {
  const page = readLogPage({ directory: workDir, file: fileName, pid: process.pid });
  assert.equal(page.file?.name, fileName);
  assert.deepEqual(
    page.entries.map((entry) => entry.message),
    ["first"],
  );

  const download = readLogDownload(fileName, { directory: workDir, pid: process.pid });
  assert.equal(download.file.name, fileName);
  assert.match(download.data.toString("utf8"), /first/);
});
