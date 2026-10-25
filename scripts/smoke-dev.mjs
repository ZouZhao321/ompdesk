#!/usr/bin/env bun
/**
 * 开发模式冒烟：真实编译开发图谱并请求页面。
 *
 * `bun run build` 只编译生产图谱，`node:` 内置模块被带进 edge 或浏览器图谱这类
 * 错误只有开发编译器才会触发，也只有在开发模式下打开页面才看得见。这个脚本把
 * 那条路径跑一遍：启动 dev server，等首页返回，再请求一个 API 路由，最后扫描
 * 日志里是否出现构建失败。
 *
 * 端口与产物目录都可以用环境变量覆盖，默认值相互独立于 `bun run dev` 使用的
 * 30141 与 `.next`，因此可以与本机正在运行的开发实例并存。启用密码锁的机器用
 * `OMPDESK_SMOKE_AUTH=用户名:密码` 传入 Basic 认证，否则首页会固定返回 401。
 */

import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HOST = "127.0.0.1";
const PORT = Number(process.env.OMPDESK_SMOKE_PORT ?? 30199);
const DIST_DIR = process.env.OMPDESK_DIST_DIR ?? ".next-smoke";
const STARTUP_TIMEOUT_MS = Number(process.env.OMPDESK_SMOKE_STARTUP_MS ?? 240_000);
const BASE_URL = `http://${HOST}:${PORT}`;
const AUTH = process.env.OMPDESK_SMOKE_AUTH ?? "";
const AUTH_HEADER = AUTH ? `Basic ${Buffer.from(AUTH).toString("base64")}` : null;

/** 这些字符串出现在开发服务器日志里，说明这一轮不能算通过。 */
const FAILURE_PATTERNS = [
  "Module build failed",
  "UnhandledSchemeError",
  "Failed to compile",
  "Cannot find module",
  "EADDRINUSE",
  "address already in use",
];

const output = [];
let childExit = null;
let childError = null;

const child = spawn(
  process.execPath,
  ["--bun", "next", "dev", "--webpack", "-H", HOST, "-p", String(PORT)],
  {
    // 工程根固定在仓库根，调用者从哪个目录执行都不影响 next 找 app/ 与产物目录。
    cwd: ROOT,
    env: { ...process.env, OMPDESK_DIST_DIR: DIST_DIR },
    stdio: ["ignore", "pipe", "pipe"],
    // POSIX 下建独立进程组，收尾时按组结束，避免 next 派生的子进程占着端口。
    detached: process.platform !== "win32",
  },
);

function record(chunk) {
  const text = chunk.toString();
  output.push(text);
  process.stderr.write(text);
}

child.stdout.on("data", record);
child.stderr.on("data", record);
child.on("error", (error) => {
  childError = error;
});
child.on("exit", (code, signal) => {
  childExit = { code, signal };
});

/** 端口被占用时不能继续：否则请求会打到旧服务上，冒烟结果失真。 */
function probePort() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: HOST, port: PORT });
    const finish = (inUse) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1_000, () => finish(false));
  });
}

/**
 * 按进程组收尾。直接子进程先退出、孙进程仍占着端口是常见情形，所以这里不看
 * `childExit` 提前返回；Windows 用 taskkill /T 结束整棵树。
 */
async function stopServer() {
  if (!child.pid) return;
  const send = (signal) => {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    }
    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        // 已经退出
      }
    }
  };
  const exited = childExit ? Promise.resolve() : new Promise((resolve) => child.once("exit", resolve));
  send("SIGTERM");
  const force = setTimeout(() => send("SIGKILL"), 5_000);
  await Promise.race([exited, Bun.sleep(6_000)]);
  clearTimeout(force);
}

function shutdown(code) {
  void stopServer().then(() => process.exit(code));
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

function logTail(limit = 80) {
  return output.join("").split(/\r?\n/).slice(-limit).join("\n");
}

async function request(path, timeoutMs) {
  const response = await fetch(`${BASE_URL}${path}`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "user-agent": "ompdesk-smoke",
      ...(AUTH_HEADER ? { authorization: AUTH_HEADER } : {}),
    },
  });
  return { status: response.status, body: await response.text() };
}

/** 首页第一次请求会触发整页编译，所以单次请求给足时间，重试只用于连接被拒。 */
async function waitForPage() {
  const startedAt = Date.now();
  for (;;) {
    if (childExit) {
      throw new Error(`dev server 提前退出：code=${childExit.code} signal=${childExit.signal}`);
    }
    if (childError) throw new Error(`dev server 启动失败：${childError.message}`);
    if (Date.now() - startedAt > STARTUP_TIMEOUT_MS) {
      throw new Error(`dev server 在 ${STARTUP_TIMEOUT_MS}ms 内没有响应 ${BASE_URL}`);
    }
    try {
      return await request("/", STARTUP_TIMEOUT_MS);
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") throw error;
      await Bun.sleep(1_000);
    }
  }
}

function assertCheck(failures, name, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(`${name}: ${detail}`);
}

const failures = [];
try {
  if (await probePort()) {
    throw new Error(`端口 ${PORT} 已被占用，先结束占用它的进程再跑冒烟`);
  }

  const page = await waitForPage();
  assertCheck(failures, "GET /", page.status === 200, `status ${page.status}`);

  // 服务可能在首页与 API 之间崩掉；断言前再确认一次它仍然活着。
  if (childExit) {
    throw new Error(`dev server 在请求过程中退出：code=${childExit.code} signal=${childExit.signal}`);
  }

  const home = await request("/api/home", 120_000);
  assertCheck(failures, "GET /api/home", home.status === 200, `status ${home.status}`);

  // 崩溃往往发生在最后一个请求之后，给进程一点时间把错误写到日志再判定。
  await Bun.sleep(1_000);
  if (childExit) {
    throw new Error(`dev server 在请求结束后退出：code=${childExit.code} signal=${childExit.signal}`);
  }

  const logText = output.join("");
  const hits = FAILURE_PATTERNS.filter((pattern) => logText.includes(pattern));
  assertCheck(failures, "构建日志无失败标记", hits.length === 0, hits.join(", "));
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  await stopServer();
}

if (failures.length > 0) {
  console.error("\n冒烟失败：");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(`\n开发服务器日志末尾：\n${logTail()}`);
  process.exit(1);
}

console.log(`\n冒烟通过：${BASE_URL} 首页与 /api/home 均返回 200，开发构建无失败标记。`);
process.exit(0);
