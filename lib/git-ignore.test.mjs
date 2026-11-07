import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkIgnoredEntries } from "./git-ignore.ts";
import { createGitEnv } from "./git-env.ts";

function createRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-git-ignore-"));
  execFileSync("git", ["init", "-q"], { cwd: dir, env: createGitEnv() });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(dir, name, content = "") {
  const target = path.join(dir, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

test("marks files and directories matched by ignore rules", async (t) => {
  const dir = createRepo(t);
  write(dir, ".gitignore", "ignored.txt\ndir/\n*.log\n!keep.log\n");
  write(dir, "dir/file.txt");
  write(dir, "other.log");
  write(dir, "keep.log");
  write(dir, "app.ts");

  const result = await checkIgnoredEntries(dir, [
    ".gitignore",
    "ignored.txt",
    "dir",
    "other.log",
    "keep.log",
    "app.ts",
  ]);

  assert.deepEqual([...(result ?? [])].sort(), ["dir", "ignored.txt", "other.log"]);
});

test("returns an empty set when nothing matches", async (t) => {
  const dir = createRepo(t);
  write(dir, "app.ts");

  assert.deepEqual(await checkIgnoredEntries(dir, ["app.ts"]), new Set());
});

test("returns null outside a Git repository", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-git-ignore-plain-"));
  fs.writeFileSync(path.join(dir, "app.ts"), "");
  try {
    assert.equal(await checkIgnoredEntries(dir, ["app.ts"]), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolves nested ignore files relative to the listed directory", async (t) => {
  const dir = createRepo(t);
  write(dir, "sub/.gitignore", "*.tmp\n");
  write(dir, "sub/a.tmp");
  write(dir, "sub/b.txt");

  const result = await checkIgnoredEntries(path.join(dir, "sub"), ["a.tmp", "b.txt"]);

  assert.deepEqual([...(result ?? [])], ["a.tmp"]);
});

test("does not report tracked files even when a pattern matches", async (t) => {
  const dir = createRepo(t);
  write(dir, ".gitignore", "tracked.txt\n");
  write(dir, "tracked.txt");
  execFileSync("git", ["add", "-f", "tracked.txt"], { cwd: dir, env: createGitEnv() });

  assert.deepEqual(await checkIgnoredEntries(dir, ["tracked.txt"]), new Set());
});
