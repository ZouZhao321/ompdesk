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
 * 30141 与 `.next`，因此可以与本机正在运行的开发实例并存。
 */

import { spawn } from "node:child_process";

const HOST = "127.0.0.1";
const PORT = Number(process.env.OMPDESK_SMOKE_PORT ?? 30199);
const DIST_DIR = process.env.OMPDESK_DIST_DIR ?? ".next-smoke";
const STARTUP_TIMEOUT_MS = Number(process.env.OMPDESK_SMOKE_STARTUP_MS ?? 240_000);
const BASE_URL = `http://${HOST}:${PORT}`;

/** 这些字符串出现在开发服务器日志里，说明页面即使返回 200 也是坏构建的产物。 */
const FAILURE_PATTERNS = [
  "Module build failed",
  "UnhandledSchemeError",
  "Failed to compile",
  "Cannot find module",
];

const output = [];
let childExit = null;

const child = spawn(
  process.execPath,
  ["--bun", "next", "dev", "--webpack", "-H", HOST, "-p", String(PORT)],
  {
    env: { ...process.env, OMPDESK_DIST_DIR: DIST_DIR },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

function record(chunk) {
  const text = chunk.toString();
  output.push(text);
  process.stderr.write(text);
}

child.stdout.on("data", record);
child.stderr.on("data", record);
child.on("exit", (code, signal) => {
  childExit = { code, signal };
});

function stopServer() {
  if (childExit) return;
  child.kill();
}

process.on("SIGINT", () => {
  stopServer();
  process.exit(130);
});

function logTail(limit = 80) {
  return output.join("").split(/\r?\n/).slice(-limit).join("\n");
}

async function request(path, timeoutMs) {
  const response = await fetch(`${BASE_URL}${path}`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": "ompdesk-smoke" },
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

let failures = [];
try {
  const page = await waitForPage();
  assertCheck(failures, "GET /", page.status === 200, `status ${page.status}`);

  const home = await request("/api/home", 120_000);
  assertCheck(failures, "GET /api/home", home.status === 200, `status ${home.status}`);

  const logText = output.join("");
  const hits = FAILURE_PATTERNS.filter((pattern) => logText.includes(pattern));
  assertCheck(failures, "构建日志无失败标记", hits.length === 0, hits.join(", "));
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  stopServer();
}

if (failures.length > 0) {
  console.error("\n冒烟失败：");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(`\n开发服务器日志末尾：\n${logTail()}`);
  process.exit(1);
}

console.log(`\n冒烟通过：${BASE_URL} 首页与 /api/home 均返回 200，开发构建无失败标记。`);
process.exit(0);
