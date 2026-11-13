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
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORK = join(ROOT, ".tmp", "pack-check");
const PACK_DIR = join(WORK, "tarball");
const CONSUMER = join(WORK, "consumer");
const HOST = "127.0.0.1";
const PORT = Number(process.env.OMPDESK_PACK_PORT ?? 30198);
const STARTUP_TIMEOUT_MS = 120_000;

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

// 装好的 CLI 既用来启动，也用来收尾：`start` 把 next 拉成后台进程后自己就退出，
// 光结束启动器进程接管不到真正在服务的那个。
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

function stopServer() {
  // `start` 把 next 拉成后台进程后启动器自己就退出了，只结束启动器接管不到真正在
  // 服务的那个进程；交给装好的 CLI 按端口停，免得遗留的 next 继续占着端口应答。
  const stopped = spawnSync(process.execPath, [installedCli, "stop", "--force", "-p", String(PORT)], {
    cwd: CONSUMER,
    env: consumerEnv,
    encoding: "utf8",
  });
  if (stopped.status !== 0) {
    process.stderr.write(
      `[pack] 停服务失败（退出码 ${stopped.status}），后续断言会读到上一个进程的回答：\n${stopped.stdout ?? ""}${stopped.stderr ?? ""}`,
    );
    process.exit(1);
  }
  if (server.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill("SIGTERM");
  }
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
  stopServer();
}

if (status !== 200) {
  process.stderr.write(`[pack] 首页在 ${STARTUP_TIMEOUT_MS / 1000} 秒内没有返回 200\n`);
  process.stderr.write(output.join("").split(/\r?\n/).slice(-60).join("\n"));
  process.exit(1);
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
