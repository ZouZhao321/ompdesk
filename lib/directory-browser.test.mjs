import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

async function loadSubject() {
  return import("./directory-browser.ts");
}

test("lists directories and directory symlinks without returning files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ompdesk-browse-"));
  try {
    await mkdir(path.join(root, "project"));
    await writeFile(path.join(root, "notes.txt"), "test", "utf8");
    await symlink(path.join(root, "project"), path.join(root, "linked-project"));

    const { listDirectories } = await loadSubject();
    const directories = await listDirectories(root);

    assert.deepEqual(directories.map((entry) => entry.name), ["linked-project", "project"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("expands home-relative paths and rejects missing directories", async () => {
  const {
    getBrowseStartDirectory,
    normalizeDirectory,
    resolveDirectory,
    shouldShowWindowsDrivePicker,
  } = await loadSubject();
  assert.equal(getBrowseStartDirectory(), homedir());
  assert.equal(getBrowseStartDirectory("/project"), "/project");
  assert.equal(shouldShowWindowsDrivePicker(undefined, "win32"), true);
  assert.equal(shouldShowWindowsDrivePicker(undefined, "darwin"), false);
  assert.equal(shouldShowWindowsDrivePicker(undefined, "linux"), false);
  assert.equal(shouldShowWindowsDrivePicker("C:\\Projects", "win32"), false);
  assert.equal(normalizeDirectory("~/project"), path.join(homedir(), "project"));
  assert.equal(normalizeDirectory("~\\project\\nested"), path.join(homedir(), "project", "nested"));
  await assert.rejects(resolveDirectory(path.join(tmpdir(), `ompdesk-missing-${Date.now()}`)));
});

test("builds every Windows drive-letter candidate", async () => {
  const { getWindowsDriveCandidates } = await loadSubject();
  const drives = getWindowsDriveCandidates();

  assert.equal(drives.length, 26);
  assert.deepEqual(drives[0], { name: "A:", path: "A:\\" });
  assert.deepEqual(drives.at(-1), { name: "Z:", path: "Z:\\" });
});

test("finds parent directories across POSIX and Windows paths", async () => {
  const { getParentDirectory } = await loadSubject();

  assert.equal(getParentDirectory("/Users/alex/project"), "/Users/alex");
  assert.equal(getParentDirectory("/"), null);
  assert.equal(getParentDirectory("C:\\Users\\Alex\\project"), "C:\\Users\\Alex");
  assert.equal(getParentDirectory("C:\\"), null);
});

test("selects the path API from the input shape, not the host platform", async () => {
  const { normalizeDirectory } = await loadSubject();

  // Windows 宿主上不能用宿主 path 解析 POSIX 输入，否则 `/Users/alex` 会变成盘符路径。
  assert.equal(normalizeDirectory("/Users/alex/project"), "/Users/alex/project");
  assert.equal(normalizeDirectory("/Users/alex/../bob"), "/Users/bob");
  assert.equal(normalizeDirectory("C:\\Users\\Alex\\project\\.."), "C:\\Users\\Alex");
  // UNC 的共享根带结尾反斜杠。
  assert.equal(normalizeDirectory("\\\\server\\share\\folder\\.."), "\\\\server\\share\\");
});

test("resolves relative input against the launcher cwd", async () => {
  const { normalizeDirectory } = await loadSubject();
  const previous = process.env.OMPDESK_LAUNCH_CWD;
  const launchCwd = path.resolve(tmpdir(), "ompdesk-launch-cwd");
  // 启动器注入的是宿主 cwd，相对输入按宿主规则拼接；断言按平台分支，不做跳过。
  const joinHost = process.platform === "win32" ? path.win32.join : path.posix.join;
  process.env.OMPDESK_LAUNCH_CWD = launchCwd;

  try {
    assert.equal(normalizeDirectory("project"), joinHost(launchCwd, "project"));
    assert.equal(normalizeDirectory("nested/../project"), joinHost(launchCwd, "project"));
    // 绝对输入自带根，不拿启动 cwd 当基准。
    assert.equal(normalizeDirectory("/Users/alex/project"), "/Users/alex/project");
  } finally {
    if (previous === undefined) delete process.env.OMPDESK_LAUNCH_CWD;
    else process.env.OMPDESK_LAUNCH_CWD = previous;
  }
});
