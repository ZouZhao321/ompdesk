"use strict";

/**
 * 给后台实例的服务进程一个不可见的控制台。
 *
 * 后台实例由启动器以 detached 拉起，服务进程因此没有控制台。Windows 上，没有控制台的进程
 * 再启动控制台程序时，系统会给每个子进程新分配一个**可见**的控制台窗口，抢走前台焦点：
 * 全屏运行的游戏会被踢出全屏。
 *
 * ompdesk 自己的子进程调用都带 `windowsHide`，但 agent 执行命令走 SDK 的原生 shell，那条
 * 路径不接受这个参数；只要宿主没有控制台，它启动的每个控制台程序都会新开窗口。给宿主一个
 * 隐藏控制台之后，子进程改为继承它，窗口不再出现。
 *
 * 已经有控制台的进程（前台实例、终端里直接运行）保持原状：子进程要留在同一个控制台组里，
 * Ctrl+C 与关闭终端才能送达。
 *
 * 这个模块放在 `bin/` 而不是 `lib/`：npm 包的 `files` 只含 `bin/`、构建产物与 `public/`，
 * 服务端要按 URL 加载它（与 `bin/web-auth-store.js` 同一路径），因此保持零依赖的 CommonJS。
 */

/** 隐藏控制台窗口的 `ShowWindow` 命令；`SW_HIDE`。 */
const SW_HIDE = 0;

/**
 * 让当前进程拥有一个不可见的控制台。
 *
 * @param {{ platform?: string, ffi?: { dlopen: Function, FFIType: object } }} [deps]
 *   平台与 FFI 入口按参数传入，用例才能在不改全局 `Bun` 的前提下覆盖每条分支。
 * @returns {boolean} 是否真的分配并隐藏了控制台。
 *
 * 返回 `false` 的三种情况都是「保持原状」：当前平台不需要、进程本来就有控制台、
 * 分配失败。分配失败保持原状——没有控制台只是会弹窗，不该让服务起不来。
 */
function ensureHiddenConsole(deps = {}) {
  const platform = deps.platform ?? process.platform;
  if (platform !== "win32") return false;
  if (typeof process.versions.bun !== "string") return false;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffi = deps.ffi ?? require("bun:ffi");
  const { dlopen, FFIType } = ffi;

  const kernel32 = dlopen("kernel32.dll", {
    AllocConsole: { args: [], returns: FFIType.i32 },
    GetConsoleWindow: { args: [], returns: FFIType.ptr },
  });

  // 已经有控制台：前台实例与启动器共用它，子进程必须留在同一组里。
  if (Number(kernel32.symbols.GetConsoleWindow()) !== 0) return false;
  if (Number(kernel32.symbols.AllocConsole()) === 0) return false;

  const window = kernel32.symbols.GetConsoleWindow();
  if (Number(window) === 0) return false;

  const user32 = dlopen("user32.dll", {
    ShowWindow: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  });
  user32.symbols.ShowWindow(window, SW_HIDE);
  return true;
}

module.exports = { ensureHiddenConsole };
