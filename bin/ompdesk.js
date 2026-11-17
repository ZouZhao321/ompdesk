#!/usr/bin/env bun
"use strict";

const {
  getMissingBunMessage,
  getUnsupportedBunVersionMessage,
  isBunVersionSupported,
  resolveBunPath,
  resolveDistDir,
  withLoopbackNoProxy,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require("./runtime");

if (process.versions.bun && !isBunVersionSupported(process.versions.bun)) {
  console.error(getUnsupportedBunVersionMessage(process.versions.bun));
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseLaunchOptions, loopbackBindingError, usageText, browserUrl } = require("./ompdesk-options");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { forwardStopSignals, shouldForwardInterrupt, signalExitCode } = require("./stop-signals");
const {
  getWebAuthStatus,
  resolveWebAuthFile,
  setWebPassword,
  setWebPasswordEnabled,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require("./web-auth-store");
const {
  PromptAbortedError,
  isInteractive,
  readNewPassword,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require("./password-prompt");

const pkgDir = path.join(__dirname, "..");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version: pkgVersion } = require("../package.json");
// `next.config.ts` 用同一个函数、同一个版本号算产物目录，启动器检查的目录就是
// 服务端接下来要服务的目录。
const nextDir = path.resolve(pkgDir, resolveDistDir(pkgVersion, process.env.OMPDESK_DIST_DIR));

// Resolve next's CLI entry directly to avoid relying on .bin symlinks (which
// may not exist when installed via npx/bunx).
let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
  // Fallback: locate next package root and derive the bin path manually.
  try {
    const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
    nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
  } catch {
    nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
  }
}

const options = parseLaunchOptions();
const { port, hostname, openBrowser, authenticated, resetPassword, help } = options;

if (options.error) {
  console.error(options.error);
  console.error(usageText());
  process.exit(2);
}
if (help) {
  console.log(usageText());
  process.exit(0);
}

const loopbackHostnames = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
// Resolved once here and handed to the server through the environment, so the
// launcher and the Next.js process can never disagree about which credential
// file is in force.
const webAuthFile = resolveWebAuthFile();
// `[::1]` is accepted by the loopback check as a way of writing an address, but
// it is not something `net.connect` or `next -H` accept: they want the bare
// `::1`. Normalising once here keeps the probe and the child in step.
const serverHost = hostname.replace(/^\[|\]$/g, "");

let bunPath = null;

function requireServerPrerequisites() {
  const bindingError = loopbackBindingError(hostname);
  if (bindingError) {
    console.error(bindingError);
    process.exit(1);
  }
  if (!fs.existsSync(nextDir)) {
    console.error("Build artifacts not found. Please report this issue.");
    process.exit(1);
  }
  bunPath = resolveBunPath();
  if (!bunPath) {
    console.error(getMissingBunMessage());
    process.exit(1);
  }
}

/** Refuse to hang on a password prompt nobody is there to answer. */
function requireTerminal(flag) {
  if (isInteractive()) return;
  throw new Error(
    [
      `${flag} has to ask for a password, but ompdesk is not attached to a terminal.`,
      "Run ompdesk once interactively to set the password, or pass OMPDESK_PASSWORD in the environment.",
    ].join("\n"),
  );
}

async function setPasswordInteractively(intro) {
  console.log(intro);
  console.log(`It is stored as a scrypt hash in ${webAuthFile} — ompdesk never keeps the password itself.`);
  const password = await readNewPassword();
  const status = setWebPassword(password, { file: webAuthFile });
  console.log(`Password saved. ompdesk now asks for the username "${status.username}" and this password.`);
}

/**
 * Settle password access before the server starts.
 *
 * A run that was asked to be locked must never come up unlocked, so the
 * credential is written first and the server is spawned afterwards.
 */
async function configurePasswordAccess() {
  const status = getWebAuthStatus({ file: webAuthFile });

  if (resetPassword) {
    if (status.managedByEnvironment) {
      console.warn(
        "Warning: OMPDESK_PASSWORD is set and takes precedence over the stored password. Unset it for this reset to have any effect.",
      );
    }
    requireTerminal("--reset-password");
    await setPasswordInteractively("Setting a new ompdesk password.");
    return;
  }

  if (!authenticated) return;

  if (status.managedByEnvironment) {
    console.log("Password access is already required: OMPDESK_PASSWORD is set.");
    return;
  }
  if (status.stored) {
    if (!status.enabled) {
      setWebPasswordEnabled(true, { file: webAuthFile });
      console.log("Password access enabled with the password already stored on this machine.");
    }
    return;
  }

  requireTerminal("--authenticated");
  await setPasswordInteractively("--authenticated was requested and no ompdesk password has been set yet.");
}

function warnAboutExposure() {
  if (loopbackHostnames.has(hostname)) return;
  if (getWebAuthStatus({ file: webAuthFile }).enabled) {
    console.warn(
      `Warning: ompdesk is listening on ${hostname} with Basic Auth over HTTP. Use HTTPS or a trusted VPN to protect the password in transit.`,
    );
  } else {
    console.warn(
      `Warning: ompdesk is listening on ${hostname} without authentication. Only use this on a trusted network, or start it with --authenticated.`,
    );
  }
}

function openInBrowser(url) {
  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const openCmd = isWindows ? "start" : isMac ? "open" : "xdg-open";
  const opener = spawn(openCmd, [url], {
    shell: isWindows,
    stdio: "ignore",
    detached: true,
    // 没有控制台时 `start` 经 cmd 运行会被分配一个新窗口。
    windowsHide: true,
  });

  opener.on("error", (error) => {
    console.warn(`Could not open browser automatically: ${error.message}`);
  });

  opener.unref();
}

/**
 * Start the Next.js server in this terminal and stay attached to it.
 *
 * The launcher itself runs on Bun, and `--bun` keeps next's CLI entry on the
 * same runtime instead of handing its shebang to node. The omp SDK ships
 * TypeScript sources and `bun:` builtins, so the API routes only resolve here.
 *
 * 启动过程不碰安装目录里的任何文件：产物目录按版本分开（`resolveDistDir`），
 * 别的版本留下的缓存不可能被这次服务读到，因此这里没有需要清理的东西，也没有
 * 「删不掉就起不来」这条路径。
 *
 * stdin 与 stderr 保持继承，终端输入输出照旧直达服务端；stdout 单独接管，只为了在
 * 服务端报告就绪时打开浏览器，其余内容原样转发。停止信号由启动器转发给子进程。
 */
function startServer() {
  warnAboutExposure();

  // 同一条终端里子进程必须继承控制台：Ctrl+C 与关闭终端才带得走它；启动器自己
  // 就没有控制台时（服务管理器、输出全部重定向）才隐藏窗口，否则 Windows 会给
  // 子进程新分配一个常驻控制台。
  const launcherHasConsole = Boolean(process.stdin.isTTY || process.stdout.isTTY || process.stderr.isTTY);
  const child = spawn(bunPath, ["--bun", nextBin, "start", "-p", port, "-H", serverHost], {
    cwd: pkgDir,
    stdio: ["inherit", "pipe", "inherit"],
    windowsHide: !launcherHasConsole,
    env: {
      ...withLoopbackNoProxy(process.env),
      OMPDESK_HOSTNAME: serverHost,
      OMPDESK_AUTH_FILE: webAuthFile,
      // Preserve the directory from which `ompdesk` was launched so relative
      // project paths in the browser resolve against the user's shell cwd.
      OMPDESK_LAUNCH_CWD: process.cwd(),
    },
  });

  // 启动器自己退出不会带走子进程：信号必须转给 next，否则它成为孤儿继续占着端口。
  // SIGINT 只在启动器单独收到信号时才转，见 `shouldForwardInterrupt`。
  const interrupt = shouldForwardInterrupt({ hasConsole: launcherHasConsole, pid: process.pid });
  const stopForwarding = forwardStopSignals(child, (code) => process.exit(code), { interrupt });
  child.once("exit", stopForwarding);

  child.on("error", (error) => {
    console.error(`Failed to launch ompdesk through Bun (${bunPath}): ${error.message}`);
    process.exit(1);
  });

  let browserOpened = false;
  // 监听地址不等于可打开的地址：`0.0.0.0` / `::` 要从回环访问，IPv6 字面量在
  // URL 里要带方括号。
  const url = browserUrl(hostname, port);

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (text) => {
    process.stdout.write(text);
    if (openBrowser && !browserOpened && text.includes("Ready")) {
      browserOpened = true;
      openInBrowser(url);
    }
  });

  // 子进程被信号杀死时 `code` 是 null，退出码只能由 `signalExitCode` 给出；两者
  // 都拿不到（从未真正启动）才按失败收尾，报 0 会让服务管理器当成正常结束。
  child.on("exit", (code, signal) => process.exit(code ?? signalExitCode(signal) ?? 1));
}

configurePasswordAccess().then(
  () => {
    requireServerPrerequisites();
    startServer();
  },
  (error) => {
    if (error instanceof PromptAbortedError) process.exit(130);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
