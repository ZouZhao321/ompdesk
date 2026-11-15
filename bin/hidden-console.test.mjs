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
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const BUN = process.execPath;

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
 * `mode` 为 `without` 时跳过 register()，用来证明判定真的能变红。
 */
const SUBJECT = String.raw`
const mode = process.argv[2];
if (mode === "with") {
  process.env.NEXT_RUNTIME = "nodejs";
  const instrumentation = await import("./instrumentation.ts");
  await instrumentation.register();
}
const natives = await import("@oh-my-pi/pi-natives");
await natives.executeShell({ command: "git status --short", cwd: process.cwd() });
process.exit(0);
`;

/**
 * 跑一次判定，返回被测进程启动期间新出现的可见控制台窗口标题。
 *
 * 被测进程一律 detached + windowsHide，与后台实例的服务进程同状态。轮询先起、被测进程后起，
 * 基线里已有的窗口不算这次造成的。
 */
function countNewConsoleWindows(mode) {
  const dir = mkdtempSync(path.join(tmpdir(), "ompdesk-console-"));
  const outFile = path.join(dir, "windows.log");
  const stopFile = path.join(dir, "stop");
  const pollerFile = path.join(dir, "poller.ps1");
  // 被测脚本必须住在仓库根：SDK 是 TypeScript 源码加 `bun:` 内置模块，只有从装了依赖的这
  // 一层才解析得到。放进系统临时目录时 import 会失败、进程直接退出，判定永远通过。
  // `.tmp/` 已被忽略，是仓库约定的临时文件位置；它不一定存在（新克隆、清理之后都没有）。
  const subjectDir = path.join(root, ".tmp");
  mkdirSync(subjectDir, { recursive: true });
  const subjectFile = path.join(subjectDir, `hidden-console-subject-${process.pid}-${mode}.mjs`);
  writeFileSync(subjectFile, SUBJECT, "utf8");
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
      child.on("exit", () => {
        setTimeout(() => {
          writeFileSync(stopFile, "");
          poller.on("exit", () => {
            const fresh = readTitles().filter((title) => !before.has(title));
            rmSync(dir, { recursive: true, force: true });
            rmSync(subjectFile, { force: true });
            resolve(fresh);
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
  assert.match(source, /establishHiddenConsole\(\)/, "instrumentation 必须在 register() 里调用隐藏控制台");
  assert.match(source, /hidden-console\.js/, "必须加载 bin/hidden-console.js，那是随包分发的实现");

  const bootstrap = source.indexOf("await establishHiddenConsole()");
  const logging = source.indexOf('"lib/logging-startup.ts"');
  assert.ok(bootstrap >= 0 && logging > bootstrap, "隐藏控制台要早于其它启动步骤，任何请求之前生效");
});

test("后台实例启动的子进程不再弹出可见控制台窗口", windowCheck, async () => {
  const fresh = await countNewConsoleWindows("with");
  assert.deepEqual(fresh, [], `修复后仍然出现了可见控制台窗口：${fresh.join("、")}`);
});

test("去掉隐藏控制台时该判定会变红", windowCheck, async () => {
  // 反向用例：证明上面那条判定真的能抓到这个问题。判定失灵时这条会失败，
  // 前一条的通过因此才有意义。
  const fresh = await countNewConsoleWindows("without");
  assert.ok(fresh.length > 0, "不补隐藏控制台时应当出现可见控制台窗口；没有出现说明判定失灵，前一条用例的通过不作数");
});
