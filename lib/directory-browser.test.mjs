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
  // 单个前导反斜杠只在 Windows 宿主上是根相对路径；POSIX 上它是普通的相对名字。
  if (process.platform === "win32") {
    assert.equal(getParentDirectory("\\Users\\alex"), "\\Users");
    assert.equal(getParentDirectory("\\Users\\alex\\project"), "\\Users\\alex");
    assert.equal(getParentDirectory("\\"), null);
  } else {
    // 反斜杠不是 POSIX 分隔符，`\Users\alex` 整体是一个名字，上级就是 `.`。
    assert.equal(getParentDirectory("\\Users\\alex"), ".");
    assert.equal(getParentDirectory("\\Users\\alex\\project"), ".");
    assert.equal(getParentDirectory("\\"), ".");
  }
  assert.equal(getParentDirectory("C:folder"), "C:");
  assert.equal(getParentDirectory("C:folder\\nested"), "C:folder");
});

test("selects the path API from the input shape, not the host platform", async () => {
  const { normalizeDirectory } = await loadSubject();

  // Windows 宿主上不能用宿主 path 解析 POSIX 输入，否则 `/Users/alex` 会变成盘符路径。
  assert.equal(normalizeDirectory("/Users/alex/project"), "/Users/alex/project");
  assert.equal(normalizeDirectory("/Users/alex/../bob"), "/Users/bob");
  assert.equal(normalizeDirectory("C:\\Users\\Alex\\project\\.."), "C:\\Users\\Alex");
  // UNC 的共享根带结尾反斜杠。
  assert.equal(normalizeDirectory("\\\\server\\share\\folder\\.."), "\\\\server\\share\\");
  // 结尾分隔符与无分隔符的同一目录归一成同一个值；根目录本身保留自己的分隔符。
  assert.equal(normalizeDirectory("/Users/alex/project/"), "/Users/alex/project");
  assert.equal(normalizeDirectory("/Users/alex/project//"), "/Users/alex/project");
  assert.equal(normalizeDirectory("C:\\Users\\Alex\\project\\"), "C:\\Users\\Alex\\project");
  assert.equal(normalizeDirectory("/"), "/");
  assert.equal(normalizeDirectory("C:\\"), "C:\\");
  // POSIX 下反斜杠是合法文件名字符：`/tmp/foo\` 是名字以反斜杠结尾的目录，它不是
  // 结尾分隔符，不能被一并剥掉。
  assert.equal(normalizeDirectory("/tmp/foo\\"), "/tmp/foo\\");
  // 名字以反斜杠结尾的目录再带正斜杠时，只剥正斜杠。
  assert.equal(normalizeDirectory("/tmp/foo\\/"), "/tmp/foo\\");
});

test("treats forward-slash UNC input as Windows-only", async () => {
  const { isWindowsPathInput } = await loadSubject();

  // POSIX 宿主上 `//tmp/x` 与 `/tmp/x` 等价，按 Windows 归一成 `\\tmp\x` 后 stat 会失败。
  assert.equal(isWindowsPathInput("//tmp/x", "linux"), false);
  assert.equal(isWindowsPathInput("//tmp/x", "darwin"), false);
  assert.equal(isWindowsPathInput("//server/share", "win32"), true);
  // 反斜杠开头的 UNC 在任何宿主上都只能是 Windows 路径。
  assert.equal(isWindowsPathInput("\\\\server\\share", "linux"), true);
  assert.equal(isWindowsPathInput("C:\\Users", "linux"), true);
  assert.equal(isWindowsPathInput("/Users/alex", "win32"), false);
});

test("treats drive-relative input as Windows and root-relative input as host-dependent", async () => {
  const { isWindowsPathInput } = await loadSubject();

  // 单个前导反斜杠只是 Windows 的根相对写法：POSIX 上 `\data\log` 是合法的相对
  // 名字，判成 Windows 会被 win32 归一成 `\\data\log` 而指向别处。
  assert.equal(isWindowsPathInput("\\Users\\alex", "linux"), false);
  assert.equal(isWindowsPathInput("\\Users\\alex", "darwin"), false);
  assert.equal(isWindowsPathInput("\\Users\\alex", "win32"), true);
  // 盘符相对路径（`C:folder`）没有分隔符，但盘符已经把它限定在 Windows。
  assert.equal(isWindowsPathInput("C:folder", "linux"), true);
  assert.equal(isWindowsPathInput("C:folder", "darwin"), true);
  assert.equal(isWindowsPathInput("C:", "linux"), true);
  // 带盘符的 POSIX 绝对路径与普通相对输入仍按宿主形态判断。
  assert.equal(isWindowsPathInput("/Users/alex", "linux"), false);
  assert.equal(isWindowsPathInput("project", "linux"), false);
  assert.equal(isWindowsPathInput("project", "win32"), false);
  assert.equal(isWindowsPathInput("~/project", "linux"), false);
});

test("keeps drive-relative input on the host resolution path", async () => {
  const { normalizeDirectory } = await loadSubject();
  const previous = process.env.OMPDESK_LAUNCH_CWD;
  const launchCwd = path.resolve(tmpdir(), "ompdesk-launch-cwd");
  process.env.OMPDESK_LAUNCH_CWD = launchCwd;

  // `C:folder` 是 Windows 形态但没有分隔符，`path.win32.isAbsolute` 判 false，因此落到
  // 宿主 `path.resolve`：Windows 宿主按「C 盘当前目录」解析，POSIX 宿主没有这个状态，
  // 拼成 `<hostCwd>/C:folder`。断言按平台分支，不做跳过。
  const expected = process.platform === "win32"
    ? path.win32.resolve(launchCwd, "C:folder")
    : path.posix.join(launchCwd, "C:folder");

  try {
    assert.equal(normalizeDirectory("C:folder"), expected);
    // 盘符后带分隔符时仍是绝对路径，不走宿主 cwd。
    assert.equal(normalizeDirectory("C:\\folder"), "C:\\folder");
  } finally {
    if (previous === undefined) delete process.env.OMPDESK_LAUNCH_CWD;
    else process.env.OMPDESK_LAUNCH_CWD = previous;
  }
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
    assert.equal(normalizeDirectory("project/"), joinHost(launchCwd, "project"));
    assert.equal(normalizeDirectory("nested/../project"), joinHost(launchCwd, "project"));
    // 绝对输入自带根，不拿启动 cwd 当基准。
    assert.equal(normalizeDirectory("/Users/alex/project"), "/Users/alex/project");
  } finally {
    if (previous === undefined) delete process.env.OMPDESK_LAUNCH_CWD;
    else process.env.OMPDESK_LAUNCH_CWD = previous;
  }
});

test("与 file-access 的 isWindowsAbsolutePath 只在文档写明的输入上分歧", async () => {
  const { isWindowsPathInput } = await loadSubject();
  const { isWindowsAbsolutePath } = await import("./file-access.ts");

  // [输入, 非 Windows 宿主, Windows 宿主, isWindowsAbsolutePath]。两边判的是不同的问题：
  // 这里选路径 API，那里判绝对路径。表里分歧的三行是 `isWindowsPathInput` 注释列出的
  // 全部差异，改动任一判定都会在这里断掉。
  const cases = [
    ["C:\\x", true, true, true],
    ["C:/x", true, true, true],
    ["\\\\server\\share", true, true, true],
    ["C:folder", true, true, false],
    ["C:", true, true, false],
    ["\\Users", false, true, false],
    ["//server/share", false, true, true],
    ["/Users/alex", false, false, false],
    ["project", false, false, false],
    ["~/project", false, false, false],
  ];

  for (const [input, posixHost, windowsHost, absolute] of cases) {
    assert.equal(isWindowsPathInput(input, "linux"), posixHost, `${input} 在 POSIX 宿主的判定`);
    assert.equal(isWindowsPathInput(input, "darwin"), posixHost, `${input} 在 macOS 宿主的判定`);
    assert.equal(isWindowsPathInput(input, "win32"), windowsHost, `${input} 在 Windows 宿主的判定`);
    assert.equal(isWindowsAbsolutePath(input), absolute, `${input} 的绝对路径判定`);
  }
});
