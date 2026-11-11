"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { existsSync } = require("fs");
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
 * 构建产物目录名，构建与服务端必须得到同一个名字。
 *
 * 目录名带上版本，是因为安装只会覆盖新包里的文件：服务端运行时写下的
 * `.next/server/route-cache` 会留在安装目录里继续被读写，而 next 的路由缓存键
 * 不含构建标识（`/route-cache/<kind>/<sha256(route)>/$<path>`），下一版会把它当成
 * 自己这次构建的预渲染结果返回，界面就停在旧版本。每个版本只读自己的目录，别的
 * 版本留下的缓存不可能被读到，启动时也就不需要删任何文件。
 *
 * `OMPDESK_DIST_DIR` 仍然整体换目录：冒烟测试靠它把产物与日常开发隔开。
 *
 * @param {string} version `package.json` 里的版本号
 * @param {string} [override] `OMPDESK_DIST_DIR`
 * @returns {string}
 */
function resolveDistDir(version, override) {
  const explicit = typeof override === "string" ? override.trim() : "";
  return explicit || `.next-v${version}`;
}

module.exports = {
  MIN_BUN_VERSION,
  getMissingBunMessage,
  getUnsupportedBunVersionMessage,
  isBunVersionSupported,
  resolveBunPath,
  resolveDistDir,
  withLoopbackNoProxy,
};
