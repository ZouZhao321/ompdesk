/**
 * 后台实例的服务进程必须带着不可见的控制台启动。
 *
 * 用户症状：更新到 1.1 之后，后台实例运行期间玩全屏游戏会突然退出全屏。服务进程由启动器以
 * detached 拉起、没有控制台；此后它启动的每个控制台程序，Windows 都会新建一个可见的控制台
 * 窗口并抢走前台焦点。ompdesk 自己的子进程调用都带 `windowsHide`，但 agent 执行命令走 SDK
 * 的原生 shell，那条路径不接受这个参数——只能让服务进程自己有一个隐藏控制台，让子进程继承它。
 *
 * 判定用系统口径：轮询枚举可见的 `ConsoleWindowClass` 窗口，只统计被测进程启动期间新出现的。
 * 下面两条用例互为对照：带上修复必须没有新窗口，去掉修复必须出现新窗口；只保留前者时，
 * 判定失灵会让用例静默通过。
 *
 * 被测进程必须真的跑起来：脚本 import 失败会立刻退出、一个窗口都不产生，正向用例就会假通过。
 * 因此被测脚本里的路径一律用绝对 URL 注入，并且两条用例都断言子进程以 0 退出。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const BUN = process.execPath;
const instrumentationUrl = pathToFileURL(path.join(root, "instrumentation.ts")).href;

/** 枚举可见控制台窗口：只记录首次出现，5 毫秒一轮，直到 stop 文件出现。 */
const POLLER = String.raw`
param([string]$Out, [string]$StopFile)
Add-Type -Namespace K -Name W -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
public delegate bool EnumProc(IntPtr h, IntPtr l);
[DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
'@
$seen = @{}
while (-not (Test-Path $StopFile)) {
  [K.W]::EnumWindows({
    param($h, $l)
    if (-not [K.W]::IsWindowVisible($h)) { return $true }
    $cls = New-Object System.Text.StringBuilder 128
    [void][K.W]::GetClassName($h, $cls, 128)
    if ($cls.ToString() -ne 'ConsoleWindowClass') { return $true }
    $key = [int64]$h
    if ($seen.ContainsKey($key)) { return $true }
    $seen[$key] = $true
    $title = New-Object System.Text.StringBuilder 256
    [void][K.W]::GetWindowText($h, $title, 256)
    Add-Content -Path $Out -Value $title
    return $true
  }, [IntPtr]::Zero) | Out-Null
  Start-Sleep -Milliseconds 5
}
`;

/**
 * 被测进程：先跑 instrumentation 的 register()（修复路径），再走 agent 执行命令的真实路径。
 *
 * `SELF` 由调用方写进脚本，是被测进程自己的绝对路径；`instrumentation.ts` 的导入 URL 也用
 * 绝对路径，因为被测脚本住在仓库根的 `.tmp/` 里，相对写法会解析到不存在的文件。
 *
 * `mode` 为 `without` 时跳过 register()，用来证明判定真的能变红。
 */
const SUBJECT_TEMPLATE = String.raw`
const mode = process.argv[2];
if (mode === "with") {
  process.env.NEXT_RUNTIME = "nodejs";
  const instrumentation = await import(${JSON.stringify(instrumentationUrl)});
  await instrumentation.register();
}
// agent 的 bash 工具最终走到这里；比原生 Shell 更贴近真实调用路径。
const { executeBash } = await import("@oh-my-pi/pi-coding-agent/exec/bash-executor");
await executeBash("git status --short", { cwd: process.cwd() });
process.exit(0);
`;

/**
 * 跑一次判定，返回被测进程启动期间新出现的可见控制台窗口标题与子进程退出码。
 *
 * 被测进程一律 detached + windowsHide，与后台实例的服务进程同状态。轮询先起、被测进程后起，
 * 基线里已有的窗口不算这次造成的。
 */
function countNewConsoleWindows(mode) {
  const dir = mkdtempSync(path.join(tmpdir(), "ompdesk-console-"));
  const outFile = path.join(dir, "windows.log");
  const stopFile = path.join(dir, "stop");
  const pollerFile = path.join(dir, "poller.ps1");
  // 被测脚本住在仓库根：SDK 是 TypeScript 源码加 `bun:` 内置模块，只有从装了依赖的这一层才
  // 解析得到。`.tmp/` 已被忽略，是仓库约定的临时文件位置，新克隆或清理之后可能不存在。
  const subjectDir = path.join(root, ".tmp");
  mkdirSync(subjectDir, { recursive: true });
  const subjectFile = path.join(subjectDir, `hidden-console-subject-${process.pid}-${mode}.mjs`);
  writeFileSync(subjectFile, SUBJECT_TEMPLATE, "utf8");
  writeFileSync(pollerFile, POLLER, "utf8");

  const poller = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", pollerFile, "-Out", outFile, "-StopFile", stopFile],
    { windowsHide: true, stdio: ["ignore", "ignore", "ignore"] },
  );

  const readTitles = () =>
    existsSync(outFile)
      ? readFileSync(outFile, "utf8")
          .split("\n")
          .filter((line) => line.trim())
      : [];

  return new Promise((resolve) => {
    setTimeout(() => {
      const before = new Set(readTitles());
      const child = spawn(BUN, [subjectFile, mode], {
        cwd: root,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore"],
      });
      child.unref();
      child.on("exit", (code) => {
        setTimeout(() => {
          writeFileSync(stopFile, "");
          poller.on("exit", () => {
            const fresh = readTitles().filter((title) => !before.has(title));
            rmSync(dir, { recursive: true, force: true });
            rmSync(subjectFile, { force: true });
            resolve({ fresh, code });
          });
        }, 500);
      });
    }, 1500);
  });
}

// 判定依赖真实的控制台窗口枚举，只在 Windows 桌面会话里有意义。
// 每轮先起轮询器建立基线、再等被测进程跑完 SDK shell、再等窗口收尾，单轮约 2 秒。
const windowCheck = {
  skip: process.platform === "win32" ? false : "只在 Windows 上出现控制台窗口",
  timeout: 30_000,
};

test("instrumentation 在服务进程启动时补上隐藏控制台", () => {
  const source = readFileSync(path.join(root, "instrumentation.ts"), "utf8");
  assert.match(source, /ensureHiddenConsole\(\)/, "instrumentation 必须在 register() 里补隐藏控制台");
  assert.match(source, /hidden-console\.js/, "必须加载 bin/hidden-console.js，那是随包分发的实现");

  const bootstrap = source.indexOf("ensureHiddenConsole()");
  const logging = source.indexOf('"lib/logging-startup.ts"');
  assert.ok(bootstrap >= 0 && logging > bootstrap, "隐藏控制台要早于其它启动步骤，任何请求之前生效");
});

test("后台实例启动的子进程不再弹出可见控制台窗口", windowCheck, async () => {
  const { fresh, code } = await countNewConsoleWindows("with");
  // 被测进程没跑完就退出时，一个窗口都不会产生，下面的断言会假通过。
  assert.equal(code, 0, "被测进程必须正常结束；非 0 说明它中途失败，判定结果不作数");
  assert.deepEqual(fresh, [], `修复后仍然出现了可见控制台窗口：${fresh.join("、")}`);
});

test("去掉隐藏控制台时该判定会变红", windowCheck, async () => {
  // 反向用例：证明上面那条判定真的能抓到这个问题。判定失灵时这条会失败，
  // 前一条的通过因此才有意义。
  const { fresh, code } = await countNewConsoleWindows("without");
  assert.equal(code, 0, "被测进程必须正常结束；非 0 说明它中途失败，判定结果不作数");
  assert.ok(fresh.length > 0, "不补隐藏控制台时应当出现可见控制台窗口；没有出现说明判定失灵，前一条用例的通过不作数");
});

/**
 * 分配隐藏控制台之后，重定向到文件的 stdout 与 stderr 是否还完整。
 *
 * 后台实例把服务进程的两路输出都接到运行日志文件。若分配控制台把重定向覆盖掉，日志会静默
 * 丢失，用户出事时查不到原因，所以我放独立用例守住它。
 */
const LOG_SUBJECT = String.raw`
const mode = process.argv[2];
if (mode === "with") {
  process.env.NEXT_RUNTIME = "nodejs";
  const instrumentation = await import(${JSON.stringify(instrumentationUrl)});
  await instrumentation.register();
}
process.stdout.write("[probe] stdout-line\n");
process.stderr.write("[probe] stderr-line\n");
await new Promise((resolve) => setTimeout(resolve, 200));
process.exit(0);
`;

test("分配隐藏控制台之后，重定向到文件的输出仍然完整", windowCheck, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ompdesk-log-"));
  const logFile = path.join(dir, "run.log");
  const subjectDir = path.join(root, ".tmp");
  mkdirSync(subjectDir, { recursive: true });
  const subjectFile = path.join(subjectDir, `hidden-console-log-${process.pid}.mjs`);
  writeFileSync(subjectFile, LOG_SUBJECT, "utf8");

  const code = await new Promise((resolve) => {
    // 与后台实例的 startDaemon 一致：两路输出都指向同一个日志文件句柄。
    const fd = openSync(logFile, "a");
    const child = spawn(BUN, [subjectFile, "with"], {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", fd, fd],
    });
    closeSync(fd);
    child.unref();
    child.on("exit", (exitCode) => resolve(exitCode));
  });

  const text = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
  rmSync(dir, { recursive: true, force: true });
  rmSync(subjectFile, { force: true });

  assert.equal(code, 0, "被测进程必须正常结束");
  assert.match(text, /stdout-line/, "分配隐藏控制台之后 stdout 必须仍然写进日志文件");
  assert.match(text, /stderr-line/, "分配隐藏控制台之后 stderr 必须仍然写进日志文件");
});
