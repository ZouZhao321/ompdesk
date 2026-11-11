"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { existsSync, rmSync } = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { delimiter, join } = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { homedir } = require("os");

const MIN_BUN_VERSION = "1.4.2";

function parseVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version ?? ""));
  if (!match) return null;
  return match.slice(1).map(Number);
}

function isAtLeast(version, minimum) {
  const current = parseVersion(version);
  const floor = parseVersion(minimum);
  if (!current || !floor) return false;

  for (let index = 0; index < floor.length; index += 1) {
    if (current[index] > floor[index]) return true;
    if (current[index] < floor[index]) return false;
  }
  return true;
}

function getUnsupportedBunVersionMessage(version) {
  return [
    `ompdesk requires Bun ${MIN_BUN_VERSION} or newer.`,
    `Current Bun version: ${version}.`,
    "Upgrade Bun and try again: https://bun.sh/",
  ].join("\n");
}

function isBunVersionSupported(version) {
  return isAtLeast(version, MIN_BUN_VERSION);
}

function bunExecutableName() {
  return process.platform === "win32" ? "bun.exe" : "bun";
}

/**
 * Locate a Bun executable.
 *
 * omp's SDK (`@oh-my-pi/pi-*`) ships TypeScript sources and imports `bun:`
 * builtins, so the server half of ompdesk can only run on the Bun runtime.
 * Order: the current process (when ompdesk itself was launched by Bun), an
 * explicit `OMPDESK_BUN` override, `$BUN_INSTALL/bin`, `~/.bun/bin`, `$PATH`.
 */
function resolveBunPath(env = process.env) {
  // An explicit override wins even when Bun is already running us, so an
  // operator can pin a specific build without changing PATH.
  const candidates = [];
  if (env.OMPDESK_BUN) candidates.push(env.OMPDESK_BUN);
  if (!env.OMPDESK_BUN && process.versions.bun && process.execPath) return process.execPath;

  if (env.BUN_INSTALL) candidates.push(join(env.BUN_INSTALL, "bin", bunExecutableName()));
  candidates.push(join(homedir(), ".bun", "bin", bunExecutableName()));
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir) candidates.push(join(dir, bunExecutableName()));
  }

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // Unreadable PATH entry — keep looking.
    }
  }
  return null;
}

function getMissingBunMessage() {
  return [
    "ompdesk could not find a Bun runtime.",
    "",
    "The omp SDK (@oh-my-pi/pi-*) is distributed as TypeScript sources and uses",
    "Bun-only builtins, so ompdesk serves its API routes on Bun — exactly like",
    "the omp CLI itself.",
    "",
    "Install Bun and try again:",
    "  curl -fsSL https://bun.sh/install | bash        # macOS / Linux",
    '  powershell -c "irm bun.sh/install.ps1 | iex"    # Windows',
    "",
    "Already installed somewhere unusual? Point ompdesk at it:",
    "  OMPDESK_BUN=/path/to/bun ompdesk",
  ].join("\n");
}

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1"];

/**
 * Bun 1.4 started sending loopback requests through `HTTP_PROXY` too, which
 * breaks local providers (ollama, lm-studio, llama.cpp) behind a proxy. Bun
 * honors `NO_PROXY` for them, and reads the proxy environment only once at
 * startup, so the launcher has to add loopback before Bun is spawned.
 */
function withLoopbackNoProxy(env) {
  const proxied = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"].some((name) => env[name]);
  if (!proxied) return env;
  const current = env.NO_PROXY ?? env.no_proxy ?? "";
  if (current.trim() === "*") return env;
  const entries = current
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const missing = LOOPBACK_HOSTS.filter((host) => !entries.includes(host));
  if (missing.length === 0) return env;
  const value = [...entries, ...missing].join(",");
  return { ...env, NO_PROXY: value, no_proxy: value };
}

/**
 * 删除上一版留在安装目录里的 ISR 路由缓存。
 *
 * 旧版本把 `.next/server/route-cache` 一起打进了 npm 包。升级只覆盖新包里的
 * 文件，这层缓存不会被替换，`next start` 会优先返回其中预渲染的首页，而首页
 * 引用的是上一轮的构建产物，界面因此停在旧版本。启动前清掉它，让服务用本次
 * 安装的 `server/app` 重新生成页面。
 */
function clearStaleRouteCache(nextDir) {
  if (!nextDir) return false;
  const cacheDir = join(nextDir, "server", "route-cache");
  if (!existsSync(cacheDir)) return false;
  rmSync(cacheDir, { recursive: true, force: true });
  return true;
}

/**
 * 判断安装目录里的路由缓存是否可以删除。
 *
 * `.next` 是整份安装共用的，同一份安装可以在不同端口上跑多个实例；正在服务
 * 的实例会读这层缓存，删掉它等于抽走对方正在用的文件，Windows 上文件被占用
 * 时还会让删除直接失败。记录里没有 `install` 字段的实例无法判断归属，按同一
 * 份安装处理，宁可这次不清，等实例停了再清。
 */
function canClearRouteCache(liveRecords, installDir) {
  return !liveRecords.some((record) => !record.install || record.install === installDir);
}

module.exports = {
  MIN_BUN_VERSION,
  canClearRouteCache,
  clearStaleRouteCache,
  getMissingBunMessage,
  getUnsupportedBunVersionMessage,
  isBunVersionSupported,
  resolveBunPath,
  withLoopbackNoProxy,
};
