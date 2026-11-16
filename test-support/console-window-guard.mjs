/**
 * 无控制台进程里的可见控制台窗口观测。
 *
 * 后台实例的服务进程没有控制台；Windows 上这种进程每启动一个控制台程序，系统就新分配一个
 * 可见窗口并抢走前台焦点。判定口径是「被测进程存活期间新增的可见 `ConsoleWindowClass`
 * 窗口数」，属于用户症状本身。
 *
 * 用法：先在被测进程里执行服务启动入口（`instrumentation.register()`），再跑场景模块；
 * 同时起一个 5 毫秒轮询的窗口枚举器，先取基线后取增量。窗口只存在几十毫秒，轮询再慢就会漏。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根：被测进程必须从这里启动，SDK 的 TypeScript 源码才解析得到依赖。 */
export const REPO_ROOT = path.join(HERE, "..");

/** 被测进程入口：执行启动入口与场景模块。 */
export const SUBJECT_SCRIPT = path.join(HERE, "console-window-subject.mjs");

/** 判定依赖真实的窗口枚举，只在 Windows 桌面会话里有意义。 */
export const consoleWindowCheck = {
  skip: process.platform === "win32" ? false : "控制台窗口只出现在 Windows 上",
  timeout: 120_000,
};

/**
 * 这一批用例的临时目录：每一轮判定各占一个子目录，跑完删掉；空了也把父目录一并删掉，
 * 仓库里不留空壳。目录在仓库内，被测进程才能从仓库根解析到 SDK 的依赖。夹具仓库同样
 * 建在它下面，各占一个按用例命名的子目录。
 */
export const WINDOW_TMP_ROOT = path.join(REPO_ROOT, ".tmp", "console-window");

/** 轮询间隔：窗口存活时间在几十毫秒量级，间隔再大就会漏掉。 */
const POLL_INTERVAL_MS = 5;
/** 轮询器启动到基线之间的等待：`Add-Type` 编译需要时间。 */
const POLLER_READY_MS = 2_000;
/** 被测进程退出到收尾之间的等待：让最后一批窗口进入记录。 */
const POLLER_SETTLE_MS = 500;

const POLLER = String.raw`
param([string]$Out, [string]$StopFile)
Add-Type -Namespace Guard -Name W -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
public delegate bool EnumProc(IntPtr h, IntPtr l);
[DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
'@
$seen = @{}
while (-not (Test-Path $StopFile)) {
  [Guard.W]::EnumWindows({
    param($h, $l)
    if (-not [Guard.W]::IsWindowVisible($h)) { return $true }
    $cls = New-Object System.Text.StringBuilder 128
    [void][Guard.W]::GetClassName($h, $cls, 128)
    if ($cls.ToString() -ne 'ConsoleWindowClass') { return $true }
    $key = [int64]$h
    if ($seen.ContainsKey($key)) { return $true }
    $seen[$key] = $true
    $title = New-Object System.Text.StringBuilder 256
    [void][Guard.W]::GetWindowText($h, $title, 256)
    $line = '{"handle":' + $key + ',"title":"' + ($title.ToString() -replace '\\', '\\\\' -replace '"', '\"') + '"}'
    Add-Content -Path $Out -Value $line
    return $true
  }, [IntPtr]::Zero) | Out-Null
  Start-Sleep -Milliseconds ${POLL_INTERVAL_MS}
}
`;

function readWindows(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parsed = JSON.parse(line);
      return { handle: parsed.handle, title: parsed.title };
    });
}

/**
 * 在无控制台进程里执行一次场景，返回期间新增的可见控制台窗口。
 *
 * @param {object} options
 * @param {"with"|"without"} options.mode `with` 先执行服务启动入口，`without` 不执行。
 * @param {string} options.scenario 场景模块的绝对路径，模块导出 `run()`。
 * @param {Record<string,string>} [options.env] 追加给被测进程与场景的环境变量。
 * @param {number} [options.timeoutMs] 被测进程的最长运行时间。
 * @returns {Promise<{
 *   newWindows: {handle:number,title:string}[],
 *   exitCode: number|null,
 *   timedOut: boolean,
 *   subjectResult: {ok: boolean, error?: string}|null
 * }>} `newWindows` 是基线之后新出现的可见控制台窗口；`exitCode` 为 `null` 表示超时或启动失败；
 *   `subjectResult` 是被测进程写的场景结果，没有写回时为 `null`。
 */
export async function measureNewConsoleWindows({ mode, scenario, env = {}, timeoutMs = 60_000 }) {
  const workDir = path.join(WINDOW_TMP_ROOT, `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(workDir, { recursive: true });
  const outFile = path.join(workDir, "windows.log");
  const stopFile = path.join(workDir, "stop");
  const pollerFile = path.join(workDir, "poller.ps1");
  const subjectResultFile = path.join(workDir, "subject.json");
  fs.writeFileSync(pollerFile, POLLER, "utf8");

  const poller = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", pollerFile, "-Out", outFile, "-StopFile", stopFile],
    { windowsHide: true, stdio: ["ignore", "ignore", "ignore"] },
  );

  try {
    await sleep(POLLER_READY_MS);
    const baseline = new Set(readWindows(outFile).map((entry) => entry.handle));

    const child = spawn(process.execPath, [SUBJECT_SCRIPT, mode, scenario], {
      cwd: REPO_ROOT,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env, ...env, OMPDESK_CONSOLE_SUBJECT_RESULT: subjectResultFile },
    });

    let timedOut = false;
    const exitCode = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill();
        } catch {
          // 已经退出。
        }
        resolve(null);
      }, timeoutMs);
      child.on("error", () => {
        clearTimeout(timer);
        resolve(null);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    await sleep(POLLER_SETTLE_MS);
    fs.writeFileSync(stopFile, "");
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      poller.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    const fresh = readWindows(outFile).filter((entry) => !baseline.has(entry.handle));
    const subjectResult = fs.existsSync(subjectResultFile)
      ? JSON.parse(fs.readFileSync(subjectResultFile, "utf8"))
      : null;
    return { newWindows: fresh, exitCode, timedOut, subjectResult };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
    try {
      fs.rmdirSync(WINDOW_TMP_ROOT);
    } catch {
      // 还有别的用例在用这个父目录，或者父目录本来就不存在，留着即可。
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
