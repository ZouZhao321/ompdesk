import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
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
  // 相对输入按宿主规则取上级：Windows 宿主上 `Users\alex` 是两段，交给 posix 会判成 `.`；
  // POSIX 宿主上整串是一个名字，反斜杠不是分隔符。
  if (process.platform === "win32") {
    assert.equal(getParentDirectory("Users\\alex\\project"), "Users\\alex");
    assert.equal(getParentDirectory("Users\\alex"), "Users");
    assert.equal(getParentDirectory("Users/alex"), "Users");
  } else {
    assert.equal(getParentDirectory("Users/alex/project"), "Users/alex");
    assert.equal(getParentDirectory("Users/alex"), "Users");
    assert.equal(getParentDirectory("Users\\alex"), ".");
  }
  assert.equal(getParentDirectory("project"), ".");
});

test("selects the path API from the input shape, not the host platform", async () => {
  const { normalizeDirectory } = await loadSubject();
  const previous = process.env.OMPDESK_LAUNCH_CWD;
  const launchCwd = process.platform === "win32" ? "D:\\ompdesk-launcher" : "/ompdesk-launcher";
  process.env.OMPDESK_LAUNCH_CWD = launchCwd;

  try {
    // 带盘符与 UNC 的输入自带根，两种宿主上归一结果相同。
    assert.equal(normalizeDirectory("C:\\Users\\Alex\\project\\.."), "C:\\Users\\Alex");
    // UNC 的共享根带结尾反斜杠。
    assert.equal(normalizeDirectory("\\\\server\\share\\folder\\.."), "\\\\server\\share\\");
    assert.equal(normalizeDirectory("C:\\Users\\Alex\\project\\"), "C:\\Users\\Alex\\project");
    assert.equal(normalizeDirectory("C:\\"), "C:\\");

    if (process.platform === "win32") {
      // Windows 宿主上 POSIX 形态的绝对输入没有盘符，是「当前盘符的根」：按启动器 cwd 的
      // 盘符补全，否则交给文件系统就由服务器进程的当前盘符决定。反斜杠在这边是分隔符，
      // 结尾的分隔符一并去掉。
      assert.equal(normalizeDirectory("/Users/alex/project"), "D:\\Users\\alex\\project");
      assert.equal(normalizeDirectory("/Users/alex/project/"), "D:\\Users\\alex\\project");
      assert.equal(normalizeDirectory("/Users/alex/project//"), "D:\\Users\\alex\\project");
      assert.equal(normalizeDirectory("/Users/alex/../bob"), "D:\\Users\\bob");
      assert.equal(normalizeDirectory("/"), "D:\\");
      assert.equal(normalizeDirectory("/tmp/foo\\"), "D:\\tmp\\foo");
      assert.equal(normalizeDirectory("/tmp/foo\\/"), "D:\\tmp\\foo");
    } else {
      assert.equal(normalizeDirectory("/Users/alex/project"), "/Users/alex/project");
      assert.equal(normalizeDirectory("/Users/alex/project/"), "/Users/alex/project");
      assert.equal(normalizeDirectory("/Users/alex/project//"), "/Users/alex/project");
      assert.equal(normalizeDirectory("/Users/alex/../bob"), "/Users/bob");
      assert.equal(normalizeDirectory("/"), "/");
      // POSIX 下反斜杠是合法文件名字符：`/tmp/foo\` 是名字以反斜杠结尾的目录，它不是
      // 结尾分隔符，不能被一并剥掉。
      assert.equal(normalizeDirectory("/tmp/foo\\"), "/tmp/foo\\");
      // 名字以反斜杠结尾的目录再带正斜杠时，只剥正斜杠。
      assert.equal(normalizeDirectory("/tmp/foo\\/"), "/tmp/foo\\");
    }
  } finally {
    if (previous === undefined) delete process.env.OMPDESK_LAUNCH_CWD;
    else process.env.OMPDESK_LAUNCH_CWD = previous;
  }
});

test("Windows 宿主把根相对输入按启动器盘符解析", async () => {
  const { normalizeDirectory } = await loadSubject();
  const previous = process.env.OMPDESK_LAUNCH_CWD;
  const launchCwd = process.platform === "win32" ? "D:\\ompdesk-launcher" : "/ompdesk-launcher";
  process.env.OMPDESK_LAUNCH_CWD = launchCwd;

  try {
    if (process.platform === "win32") {
      // `\work` 与 `/work` 都不带盘符：原样交给文件系统就由服务器进程的当前盘符决定，
      // 启动器在 D 盘、服务器在 C 盘时会落到 `C:\work`。两种情况都按启动器盘符补全。
      assert.equal(normalizeDirectory("\\work"), "D:\\work");
      assert.equal(normalizeDirectory("/work"), "D:\\work");
      assert.equal(normalizeDirectory("\\work\\nested\\"), "D:\\work\\nested");
      assert.equal(normalizeDirectory("/work/nested"), "D:\\work\\nested");
      assert.equal(normalizeDirectory("\\"), "D:\\");
      // UNC 自带根、带盘符的输入自带盘符，都不受启动器影响。
      assert.equal(normalizeDirectory("\\\\server\\share"), "\\\\server\\share\\");
      assert.equal(normalizeDirectory("E:\\work"), "E:\\work");
      return;
    }

    // POSIX 宿主没有「当前盘符」：`/work` 是 POSIX 绝对路径，`\work` 是普通相对名字，
    // 按启动器 cwd 拼接。
    assert.equal(normalizeDirectory("/work"), "/work");
    assert.equal(normalizeDirectory("\\work"), path.posix.join(launchCwd, "\\work"));
  } finally {
    if (previous === undefined) delete process.env.OMPDESK_LAUNCH_CWD;
    else process.env.OMPDESK_LAUNCH_CWD = previous;
  }
});

test("根相对输入经 resolveDirectory 与 stat 落到启动器盘符下的真实目录", async () => {
  const { normalizeDirectory, resolveDirectory } = await loadSubject();
  const root = await mkdtemp(path.join(tmpdir(), "ompdesk-root-relative-"));
  const canonical = await realpath(root);
  const previous = process.env.OMPDESK_LAUNCH_CWD;

  try {
    if (process.platform !== "win32") {
      // 非 Windows 宿主没有盘符可补：绝对输入按 POSIX 语义原样解析，这条路径不受影响。
      process.env.OMPDESK_LAUNCH_CWD = "/ompdesk-launcher";
      assert.equal(normalizeDirectory(root), root);
      assert.equal(await resolveDirectory(root), canonical);
      return;
    }

    // 去掉盘符得到 `\Users\...` 这种根相对输入，正是盘符会被换掉的那种写法。
    const driveRoot = path.win32.parse(root).root;
    const rootRelative = root.slice(driveRoot.length - 1);

    // 启动器与临时目录同盘符：输入指回这个目录，两级断言一致。
    process.env.OMPDESK_LAUNCH_CWD = driveRoot;
    assert.equal(normalizeDirectory(rootRelative), root);
    const resolved = await resolveDirectory(rootRelative);
    assert.equal(resolved, canonical);
    assert.equal((await stat(resolved)).isDirectory(), true);

    // 换到别的盘符：输入跟着启动器走，而不是服务器进程的当前盘符；该目录不存在，
    // 解析必须失败。
    const otherDrive = driveRoot.slice(0, 1).toUpperCase() === "D" ? "E" : "D";
    process.env.OMPDESK_LAUNCH_CWD = `${otherDrive}:\\ompdesk-launcher`;
    assert.equal(normalizeDirectory(rootRelative), `${otherDrive}:${rootRelative}`);
    await assert.rejects(resolveDirectory(rootRelative));
  } finally {
    if (previous === undefined) delete process.env.OMPDESK_LAUNCH_CWD;
    else process.env.OMPDESK_LAUNCH_CWD = previous;
    await rm(root, { recursive: true, force: true });
  }
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
  // 拼成 `<hostCwd>/C:folder`。断言按平台分支写，不做跳过。
  try {
    if (process.platform === "win32") {
      const resolved = normalizeDirectory("C:folder");
      assert.equal(path.win32.isAbsolute(resolved), true, "盘符相对输入应解析成绝对路径");
      assert.equal(path.win32.parse(resolved).root, "C:\\", "盘符由输入决定，不跟着启动 cwd 换");
      // 基准是 C 盘的每盘当前目录，不是进程 cwd：仓库或 TEMP 在别的盘时，进程 cwd 在 C 盘
      // 与否不改变结果。钉具体基准会在换盘符的 runner 上误报，只断言输入决定的盘符与末段。
      assert.equal(path.win32.basename(resolved), "folder");
    } else {
      assert.equal(normalizeDirectory("C:folder"), `${launchCwd}/C:folder`);
    }
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
    // 带盘符的绝对输入自带根，不拿启动 cwd 当基准。
    assert.equal(normalizeDirectory("C:\\Users\\alex\\project"), "C:\\Users\\alex\\project");
    // 没有盘符的绝对输入在 Windows 上是「当前盘符的根」，盘符取自启动 cwd；POSIX 宿主
    // 上它才是自带根的绝对路径。
    if (process.platform === "win32") {
      const drive = path.win32.parse(launchCwd).root.slice(0, 2);
      const resolved = normalizeDirectory("/Users/alex/project");
      assert.equal(path.win32.isAbsolute(resolved), true, "补全盘符后应是绝对路径");
      assert.equal(resolved, `${drive}\\Users\\alex\\project`);
    } else {
      assert.equal(normalizeDirectory("/Users/alex/project"), "/Users/alex/project");
    }
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
