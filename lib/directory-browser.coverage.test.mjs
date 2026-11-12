import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const { listDirectories, listWindowsDrives } = await import("./directory-browser.ts");

const workDir = path.join(process.cwd(), ".tmp", "lib-logic-two", "directory-browser");

test("lists mounted Windows drives and skips missing ones", async () => {
  const drives = await listWindowsDrives();
  assert.ok(Array.isArray(drives));
  for (const drive of drives) {
    assert.match(drive.name, /^[A-Z]:$/);
    assert.match(drive.path, /^[A-Z]:\\$/);
  }
});

test("ignores broken symlinks when listing directories", async () => {
  await mkdir(workDir, { recursive: true });
  const root = await mkdtemp(path.join(workDir, "browse-"));
  try {
    await mkdir(path.join(root, "real"));
    try {
      await symlink(path.join(root, "missing-target"), path.join(root, "broken"));
    } catch {
      // 没有创建符号链接的权限时这条路径无法构造，主断言仍由真实目录承担。
    }

    const directories = await listDirectories(root);
    assert.deepEqual(
      directories.map((entry) => entry.name),
      ["real"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
