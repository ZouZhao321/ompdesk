#!/usr/bin/env bun
/**
 * 打包冒烟：按用户实际下载安装的路径验证产物。
 *
 * `npm pack` 出 tgz，装进一个空项目，用装出来的 `ompdesk` 起服务并请求首页。
 * `package.json` 的 `files` 漏项、`bin` 路径写错、产物目录没打进去这类问题，
 * 只有走这条路才会暴露；`bun run build` 只看得到源码树里的构建结果。
 *
 * CI 在 PR 上跑一次，`release.yml` 在标签上跑一次，两边共用这一份步骤。
 *
 * `OMPDESK_PACK_TARBALL` 指向一个已经打好的 tgz 时跳过 `npm pack`，直接装这个
 * 文件：产物由 Linux 上的构建作业产出，Windows 与 macOS 作业只验证「装得上、
 * 起得来」，装的是同一个会发布出去的 tgz。
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORK = join(ROOT, ".tmp", "pack-check");
const PACK_DIR = join(WORK, "tarball");
const CONSUMER = join(WORK, "consumer");
const HOST = "127.0.0.1";
const PORT = Number(process.env.OMPDESK_PACK_PORT ?? 30198);
const STARTUP_TIMEOUT_MS = 120_000;
// 收尾时等子进程退出的上限：SIGTERM 一次、SIGKILL 一次，两次都超时就是清理失败。
const STOP_TIMEOUT_MS = 10_000;

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    // npm 在 Windows 上是 npm.cmd，没有 shell 时无法直接启动；POSIX 不需要。
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.stderr.write(`[pack] ${command} ${args.join(" ")} 失败\n`);
    process.exit(result.status ?? 1);
  }
}

rmSync(WORK, { recursive: true, force: true });
mkdirSync(CONSUMER, { recursive: true });

const providedTarball = process.env.OMPDESK_PACK_TARBALL?.trim();
let tarballPath;
if (providedTarball) {
  // CI 把产物下载到一个目录，tgz 文件名带版本号，这里按目录解析。
  if (statSync(providedTarball).isDirectory()) {
    const tarball = readdirSync(providedTarball).find((name) => name.endsWith(".tgz"));
    if (!tarball) {
      process.stderr.write(`[pack] ${providedTarball} 里没有 tgz\n`);
      process.exit(1);
    }
    tarballPath = join(providedTarball, tarball);
  } else {
    tarballPath = providedTarball;
  }
} else {
  mkdirSync(PACK_DIR, { recursive: true });
  // `files` 里的 `.next-v*/**` 会匹配工作区里每个版本的产物目录：旧版本的目录
  // 留着时会被一起打进 tgz，包体积翻倍，包里还带着别的构建的预渲染结果。
  const repoVersion = (await Bun.file(join(ROOT, "package.json")).json()).version;
  const staleDistDirs = readdirSync(ROOT).filter(
    (name) => name.startsWith(".next-v") && name !== `.next-v${repoVersion}`,
  );
  if (staleDistDirs.length > 0) {
    process.stderr.write(
      `[pack] 仓库里留着旧版本的产物目录：${staleDistDirs.join("、")}；先删掉它们再打包，否则 tgz 会把别的构建一起带上\n`,
    );
    process.exit(1);
  }
  run("npm", ["pack", "--pack-destination", PACK_DIR], ROOT);
  const tarball = readdirSync(PACK_DIR).find((name) => name.endsWith(".tgz"));
  if (!tarball) {
    process.stderr.write("[pack] npm pack 没有产出 tgz\n");
    process.exit(1);
  }
  tarballPath = join(PACK_DIR, tarball);
}

Bun.write(join(CONSUMER, "package.json"), '{"name":"pack-check","private":true}\n');
run(process.execPath, ["add", tarballPath], CONSUMER);

// 启动器与服务端都按包里的版本号算产物目录，装得太浅（例如漏了 `files` 里那条
// 通配）就是启动时报「Build artifacts not found」，所以这里先认准目录存在。
// 目录名由安装包自己的 `bin/runtime.js` 计算：脚本支持校验外部 tgz，工作区的
// 命名规则可能与那份产物不一致。
const installedPkg = join(CONSUMER, "node_modules", "ompdesk");
const installedVersion = (await Bun.file(join(installedPkg, "package.json")).json()).version;
const installedRuntime = createRequire(join(installedPkg, "package.json"))("./bin/runtime.js");
const installedDistDir = join(installedPkg, installedRuntime.resolveDistDir(installedVersion));
if (!existsSync(installedDistDir)) {
  process.stderr.write(`[pack] 安装包缺少产物目录 ${installedDistDir}\n`);
  process.exit(1);
}

// 服务端运行时写下的路由缓存不能进包：安装只覆盖新包里的文件，缓存里预渲染的
// 页面会被下一版当成自己这次构建的结果返回。产物里出现这个目录就说明打包排除
// 失效了。
const installedRouteCache = join(installedDistDir, "server", "route-cache");
if (existsSync(installedRouteCache)) {
  process.stderr.write(`[pack] 安装包带着 ${installedRouteCache}：升级后会继续返回旧页面\n`);
  process.exit(1);
}

// 装好的 CLI 就是启动器本身：它在前台运行服务，结束它就把整棵进程树一起结束。
const installedCli = join(installedPkg, "bin", "ompdesk.js");
const consumerEnv = { ...process.env, PI_CODING_AGENT_DIR: join(CONSUMER, "agent") };
// 断言针对默认产物目录，外部环境变量会把它换掉。
delete consumerEnv.OMPDESK_DIST_DIR;

// 模拟升级：安装目录里躺着共用产物目录时留下的路由缓存，它里面预渲染的页面
// 属于别的构建。产物目录按版本分开之后服务端根本不会读到它，启动器也不再删
// 安装目录里的任何文件——两件事都在启动之后断言。
const legacyRouteCache = join(installedPkg, ".next", "server", "route-cache");
const staleMarker = join(legacyRouteCache, "pack-check-stale.txt");
mkdirSync(legacyRouteCache, { recursive: true });
await Bun.write(staleMarker, "route cache from another build\n");

// 端口必须是空的：被无关进程占着时 next 起不来，而等首页的循环会读到那个进程的
// 回答，后面的产物断言与收尾断言都会指错方向。
if (await portAnswers()) {
  process.stderr.write(`[pack] 端口 ${PORT} 已被占用，先结束占用它的进程再运行\n`);
  process.exit(1);
}

const server = spawn(process.execPath, [installedCli, "--no-open", "-p", String(PORT)], {
  cwd: CONSUMER,
  env: consumerEnv,
  // POSIX 下放进独立进程组，收尾时整组结束，避免孙进程继续占着端口。
  detached: process.platform !== "win32",
  stdio: ["ignore", "pipe", "pipe"],
});

const output = [];
const record = (chunk) => output.push(chunk.toString());
server.stdout.on("data", record);
server.stderr.on("data", record);

// 收尾要等 stdio 读空，所以这个 Promise 在 spawn 时就挂上：等到需要它的时候
// `close` 可能已经触发过，之后再监听就永远等不到。
const closed = new Promise((resolve) => server.once("close", resolve));

/** 子进程是否已经退出：被信号结束时 `exitCode` 是 null，`signalCode` 才有值。 */
function hasExited() {
  return server.exitCode !== null || server.signalCode !== null;
}

/** 等到子进程退出；超时返回 false。 */
function exitWithin(timeoutMs) {
  if (hasExited()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    server.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/**
 * 等 stdio 读空；超时返回 false。
 *
 * `exit` 早于管道读完触发，紧接着读 `output` 打日志尾巴时，最后几行——往往正是
 * 收尾失败或报错的那几行——可能还没到。
 */
async function drainedWithin(timeoutMs) {
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const drained = await Promise.race([closed.then(() => true), timedOut]);
  clearTimeout(timer);
  return drained;
}

/** 失败收尾：连同采集到的服务端日志一起报出来，否则「为什么停不下来」无从判断。 */
function fail(message) {
  process.stderr.write(`${message}\n`);
  process.stderr.write(output.join("").split(/\r?\n/).slice(-60).join("\n"));
  process.exit(1);
}

/** 把信号送到整棵进程树。 */
function signalTree(signal) {
  if (process.platform === "win32") {
    // Windows 没有进程组，带得走 next 的只有 taskkill 的强制结束。
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-server.pid, signal);
  } catch (error) {
    // ESRCH：投递这一刻组里已经没人了；别的错误照常抛。
    if (error.code !== "ESRCH") throw error;
  }
}

/** 端口当前是否还有人应答。 */
function portAnswers() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: HOST, port: PORT });
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1_000, () => finish(false));
  });
}

/** 等端口空出来，超时返回 false。 */
async function waitForPortRelease(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (await portAnswers()) {
    if (Date.now() > deadline) return false;
    await Bun.sleep(250);
  }
  return true;
}

/**
 * 收尾：请求停止，等它真的退出，再确认端口空出来。
 *
 * 启动器与 next 都在前台，结束启动器就要连它的子进程一起结束，否则遗留的 next
 * 继续占着端口应答，后面的断言会读到上一个进程的回答。发完信号就走会把「没停下
 * 来」当成通过，所以这里等到退出为止；超时用 SIGKILL 收尾，再超时就判失败。
 * 退出码不是判据：按信号结束的进程在 POSIX 上报 143/130、在 Windows 上报 1，
 * 能说明清理成功的是「进程没了、端口空了」。
 */
async function stopServer() {
  if (!hasExited()) {
    signalTree("SIGTERM");
    if (!(await exitWithin(STOP_TIMEOUT_MS))) {
      signalTree("SIGKILL");
      if (!(await exitWithin(STOP_TIMEOUT_MS))) {
        fail(`[pack] 装出来的服务（pid ${server.pid}）结束不掉，端口 ${PORT} 仍被占用`);
      }
    }
  }

  // 启动器退出不等于整棵树退出：`exitWithin` 只看启动器，同组里卡住的 next 仍可能
  // 应答端口，SIGKILL 升级就发不出去。先给收尾一个窗口，端口还有人应答就对整棵
  // 进程树补一次 SIGKILL（进程组还在，组领导的 pid 可以用来投递），再判。
  if (await waitForPortRelease(STOP_TIMEOUT_MS)) {
    // 端口空了不代表日志读完了：等管道读空，失败分支才有完整的服务端输出。
    await drainedWithin(STOP_TIMEOUT_MS);
    return;
  }
  if (process.platform === "win32") {
    // 启动器退出后 Windows 追不到 next：`taskkill /T` 按父进程的 pid 树枚举，父
    // 进程没了就没有入口，补发信号只是空操作。这里直接判失败。
    fail(`[pack] 启动器已退出，端口 ${PORT} 仍有进程应答，Windows 上无法再追到子进程`);
  }
  signalTree("SIGKILL");
  if (await waitForPortRelease(STOP_TIMEOUT_MS)) {
    await drainedWithin(STOP_TIMEOUT_MS);
    return;
  }
  fail(`[pack] 收尾后端口 ${PORT} 仍有人应答，服务没有真正停下`);
}

const deadline = Date.now() + STARTUP_TIMEOUT_MS;
let status = 0;
let html = "";
try {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${HOST}:${PORT}/`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status === 200) {
        status = 200;
        html = await response.text();
        break;
      }
    } catch {
      // 服务还没起来：端口拒绝连接或请求超时都属于等待中的正常状态。
    }
    await Bun.sleep(1_000);
  }
} finally {
  await stopServer();
}

if (status !== 200) {
  fail(`[pack] 首页在 ${STARTUP_TIMEOUT_MS / 1000} 秒内没有返回 200`);
}

// 首页引用的静态产物必须全都装在这次安装的产物目录里：能满足这一点的只有本次
// 构建渲染出来的页面，别处预渲染留下的 HTML 指向的是别的构建的文件。
const referencedAssets = new Set(Array.from(html.matchAll(/\/_next\/static\/[^"'\s<>)\\]+/g), ([url]) => url));
if (referencedAssets.size === 0) {
  process.stderr.write("[pack] 首页没有引用任何静态产物，无法判断返回的是哪次构建\n");
  process.exit(1);
}
const missingAssets = [...referencedAssets].filter(
  (url) => !existsSync(join(installedDistDir, url.slice("/_next/".length))),
);
if (missingAssets.length > 0) {
  process.stderr.write(`[pack] 首页引用了产物目录里没有的文件：${missingAssets.slice(0, 5).join(", ")}\n`);
  process.exit(1);
}

// 启动过程不删安装目录里的任何文件：清理失败不得让应用起不来。
if (!existsSync(staleMarker)) {
  process.stderr.write(`[pack] 启动过程删除了安装目录里的文件：${staleMarker}\n`);
  process.exit(1);
}

process.stdout.write(`[pack] 装出来的包启动成功，首页返回 200（端口 ${PORT}）\n`);
