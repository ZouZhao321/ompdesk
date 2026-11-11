#!/usr/bin/env bun
"use strict";

const {
  getMissingBunMessage,
  getUnsupportedBunVersionMessage,
  isBunVersionSupported,
  resolveBunPath,
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
const { parseLaunchOptions, loopbackBindingError, usageText } = require("./ompdesk-options");
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
const {
  buildUrl,
  createControlToken,
  fetchActivity,
  formatStatus,
  isProcessAlive,
  listRecords,
  logFile,
  probePort,
  readRecord,
  recordFile,
  removeRecord,
  stateDir,
  stopRefusal,
  terminateInstance,
  waitForPort,
  writeRecord,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require("./daemon-control");

const pkgDir = path.join(__dirname, "..");
// `next.config.ts` takes its `distDir` from the same variable, so the launcher
// has to check the directory the server will actually serve.
const nextDir = path.resolve(pkgDir, process.env.OMPDESK_DIST_DIR?.trim() || ".next");

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
const { force, port, hostname, openBrowser, authenticated, resetPassword, help } = options;
const command = options.command;

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
const stateDirPath = stateDir();
const instanceFile = recordFile(stateDirPath, port);
const portNumber = Number(port);
// `[::1]` is accepted by the loopback check as a way of writing an address, but
// it is not something `net.connect` or `next -H` accept: they want the bare
// `::1`. Normalising once here keeps the record, the probe and the child in step.
const serverHost = hostname.replace(/^\[|\]$/g, "");

let bunPath = null;

/** Checks only the server path needs; `status` and `stop` work from the record alone. */
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
    // 后台实例没有控制台，`start` 经 cmd 运行时会被分配一个新窗口。
    windowsHide: true,
  });

  opener.on("error", (error) => {
    console.warn(`Could not open browser automatically: ${error.message}`);
  });

  opener.unref();
}

/**
 * Start the Next.js server.
 *
 * The launcher itself runs on Bun, and `--bun` keeps next's CLI entry on the
 * same runtime instead of handing its shebang to node. The omp SDK ships
 * TypeScript sources and `bun:` builtins, so the API routes only resolve here.
 *
 * `controlToken` is set only for a background instance, where the control
 * endpoint has to answer without the web password.
 */
function spawnServer({ stdio, detached, controlToken }) {
  return spawn(bunPath, ["--bun", nextBin, "start", "-p", port, "-H", serverHost], {
    cwd: pkgDir,
    stdio,
    detached,
    // 后台实例没有控制台；前台实例的 Ctrl+C 由 runAttached 显式转发，隐藏窗口不影响它。
    windowsHide: true,
    env: {
      ...withLoopbackNoProxy(process.env),
      OMPDESK_HOSTNAME: serverHost,
      OMPDESK_AUTH_FILE: webAuthFile,
      // Preserve the directory from which `ompdesk` was launched so relative
      // project paths in the browser resolve against the user's shell cwd.
      OMPDESK_LAUNCH_CWD: process.cwd(),
      ...(controlToken ? { OMPDESK_CONTROL_TOKEN: controlToken } : {}),
    },
  });
}

/**
 * Run the server in the foreground and stay attached.
 *
 * `start` detaches so a closing terminal cannot take the server with it; a
 * container or a service manager wants the opposite — the process it launched
 * has to stay in the foreground until it is told to stop, and signals have to
 * reach the server.
 */
async function runAttached() {
  requireServerPrerequisites();
  await configurePasswordAccess();
  warnAboutExposure();

  const child = spawnServer({ stdio: ["inherit", "inherit", "inherit"], detached: false });
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]) {
    process.on(signal, () => {
      try {
        child.kill(signal);
      } catch {
        // The server already exited; fall through to the normal exit path.
      }
      setTimeout(() => process.exit(code), 5_000).unref();
    });
  }

  child.on("error", (error) => {
    console.error(`Failed to launch ompdesk through Bun (${bunPath}): ${error.message}`);
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

/**
 * Start in the background and hand the prompt back.
 *
 * The server itself is the detached process: its pid is what the record holds,
 * so a stop reaches exactly the process holding the port and nothing has to
 * outlive it. Output goes to the run log, and the terminal it was started from
 * has no claim on it.
 */
async function startDaemon() {
  requireServerPrerequisites();
  await configurePasswordAccess();
  // The warning belongs to the launch, not to the terminal: it is the person
  // starting ompdesk who can still decide to drop `-H`.
  warnAboutExposure();

  const existing = readRecord(instanceFile);
  if (existing && isProcessAlive(existing.pid) && (await probePort(existing.host, existing.port))) {
    console.error(`ompdesk is already running at ${existing.url}`);
    process.exit(1);
  }
  if (existing) removeRecord(instanceFile);

  if (await probePort(serverHost, portNumber)) {
    console.error(`Port ${port} is already in use by another process. Stop it, or start ompdesk with --port.`);
    process.exit(1);
  }

  const controlToken = createControlToken();
  const logPath = logFile(stateDirPath, port);
  fs.mkdirSync(stateDirPath, { recursive: true });
  const logHandle = fs.openSync(logPath, "a");

  let child;
  try {
    child = spawnServer({
      stdio: ["ignore", logHandle, logHandle],
      detached: true,
      controlToken,
    });
  } finally {
    fs.closeSync(logHandle);
  }

  let exited = null;
  child.on("exit", (code, signal) => {
    exited = { code, signal };
  });
  child.on("error", (error) => {
    exited = { error };
  });
  child.unref();

  const started = await waitForPort(serverHost, portNumber, startupTimeoutMs(), true);
  if (!started || exited) {
    console.error(`ompdesk did not start. Inspect the run log: ${logPath}`);
    terminateInstance(child.pid, true);
    process.exit(1);
  }

  const record = {
    pid: child.pid,
    host: serverHost,
    port: portNumber,
    url: buildUrl(serverHost, portNumber),
    startedAt: new Date().toISOString(),
    controlToken,
    log: logPath,
    cwd: process.cwd(),
  };
  writeRecord(instanceFile, record);

  console.log(`ompdesk is running at ${record.url}`);
  console.log(`pid ${record.pid} · log ${logPath}`);
  if (openBrowser) openInBrowser(record.url);
  process.exit(0);
}

function startupTimeoutMs() {
  const raw = Number(process.env.OMPDESK_STARTUP_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 120_000;
}

/** `--port` selects one instance; without it every recorded instance is in play. */
function selectInstances() {
  return options.portExplicit ? [readRecord(instanceFile)].filter(Boolean) : listRecords(stateDirPath);
}

/** A record only counts while its process answers; anything else is a leftover to drop. */
async function liveRecord(record) {
  if (isProcessAlive(record.pid) && (await probePort(record.host, record.port))) return true;
  removeRecord(recordFile(stateDirPath, record.port));
  return false;
}

async function runStatus() {
  const records = selectInstances();
  if (records.length === 0) {
    console.log("ompdesk is not running.");
    return 0;
  }

  for (const record of records) {
    if (!(await liveRecord(record))) {
      console.log(`ompdesk on port ${record.port} is not running (removed a stale record).`);
      continue;
    }
    console.log(formatStatus(record, await fetchActivity(record)).join("\n"));
  }
  return 0;
}

/**
 * Stop one instance and report whether the port actually came back.
 *
 * Printing "stopped" while the port stays bound would leave a server running
 * with no record to reach it, so the record is only dropped once the probe says
 * the port is free. `force` skips the graceful signal instead of waiting for it.
 */
async function stopInstance(record, { force: forceful }) {
  terminateInstance(record.pid, forceful);
  const released = await waitForPort(record.host, record.port, forceful ? 4_000 : 8_000, false);
  if (!released) {
    terminateInstance(record.pid, true);
    if (await waitForPort(record.host, record.port, 4_000, false)) {
      removeRecord(recordFile(stateDirPath, record.port));
      return true;
    }
    return false;
  }
  removeRecord(recordFile(stateDirPath, record.port));
  return true;
}

async function runStop() {
  const records = selectInstances();
  if (records.length === 0) {
    console.log("ompdesk is not running.");
    return 0;
  }

  let status = 0;
  for (const record of records) {
    if (!(await liveRecord(record))) {
      console.log(`ompdesk on port ${record.port} is not running (removed a stale record).`);
      continue;
    }

    const refusal = stopRefusal(await fetchActivity(record));
    if (refusal && !force) {
      console.error(`Refusing to stop ompdesk on port ${record.port}: ${refusal}`);
      status = 1;
      continue;
    }

    if (await stopInstance(record, { force })) {
      console.log(`ompdesk on port ${record.port} stopped.`);
    } else {
      console.error(
        `ompdesk on port ${record.port} is still listening. Stop it from the process list, or retry with --force.`,
      );
      status = 1;
    }
  }
  return status;
}

async function main() {
  if (command === "status") return runStatus();
  if (command === "stop") return runStop();
  if (command === "foreground") {
    await runAttached();
    return 0;
  }
  return startDaemon();
}

main().then(
  (code) => {
    if (code) process.exit(code);
  },
  (error) => {
    if (error instanceof PromptAbortedError) process.exit(130);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
