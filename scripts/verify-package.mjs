#!/usr/bin/env bun
/**
 * 打包冒烟：按用户实际下载安装的路径验证产物。
 *
 * `npm pack` 出 tgz，装进一个空项目，用装出来的 `ompdesk` 起服务并请求首页。
 * `package.json` 的 `files` 漏项、`bin` 路径写错、`.next` 没打进去这类问题，
 * 只有走这条路才会暴露；`bun run build` 只看得到源码树里的构建结果。
 *
 * CI 在 PR 上跑一次，`release.yml` 在标签上跑一次，两边共用这一份步骤。
 *
 * `OMPDESK_PACK_TARBALL` 指向一个已经打好的 tgz 时跳过 `npm pack`，直接装这个
 * 文件：产物由 Linux 上的构建作业产出，Windows 与 macOS 作业只验证「装得上、
 * 起得来」，装的是同一个会发布出去的 tgz。
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
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
  const tarball = readdirSync(providedTarball).find((name) =>
   name.endsWith(".tgz"),
  );
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
 run("npm", ["pack", "--pack-destination", PACK_DIR], ROOT);
 const tarball = readdirSync(PACK_DIR).find((name) => name.endsWith(".tgz"));
 if (!tarball) {
  process.stderr.write("[pack] npm pack 没有产出 tgz\n");
  process.exit(1);
 }
 tarballPath = join(PACK_DIR, tarball);
}

Bun.write(
 join(CONSUMER, "package.json"),
 '{"name":"pack-check","private":true}\n',
);
run(process.execPath, ["add", tarballPath], CONSUMER);

const server = spawn(
 process.execPath,
 [
  join(CONSUMER, "node_modules", "ompdesk", "bin", "ompdesk.js"),
  "--no-open",
  "-p",
  String(PORT),
 ],
 {
  cwd: CONSUMER,
  env: { ...process.env, PI_CODING_AGENT_DIR: join(CONSUMER, "agent") },
  // POSIX 下放进独立进程组，收尾时整组结束，避免孙进程继续占着端口。
  detached: process.platform !== "win32",
  stdio: ["ignore", "pipe", "pipe"],
 },
);

const output = [];
const record = (chunk) => output.push(chunk.toString());
server.stdout.on("data", record);
server.stderr.on("data", record);

function stopServer() {
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
try {
 while (Date.now() < deadline) {
  try {
   const response = await fetch(`http://${HOST}:${PORT}/`, {
    signal: AbortSignal.timeout(5_000),
   });
   if (response.status === 200) {
    status = 200;
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
 process.stderr.write(
  `[pack] 首页在 ${STARTUP_TIMEOUT_MS / 1000} 秒内没有返回 200\n`,
 );
 process.stderr.write(output.join("").split(/\r?\n/).slice(-60).join("\n"));
 process.exit(1);
}

process.stdout.write(
 `[pack] 装出来的包启动成功，首页返回 200（端口 ${PORT}）\n`,
);
