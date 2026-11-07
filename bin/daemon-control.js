"use strict";

// Daemon bookkeeping for the ompdesk launcher: where the running instance is
// recorded, how to reach it, and how to tell a live instance from a leftover
// record. Kept in plain CommonJS because the launcher loads it before Bun is
// resolved — the same reason `web-auth-store.js` is.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawnSync } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { randomBytes } = require("crypto");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const net = require("net");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveAgentDir } = require("./web-auth-store");

const RECORD_PREFIX = "ompdesk-daemon-";
const RECORD_SUFFIX = ".json";
const CONTROL_TOKEN_HEADER = "x-ompdesk-control-token";
const PROBE_TIMEOUT_MS = 1_000;
const READY_POLL_MS = 250;

/** Instance records live beside omp's agent state, so each data directory keeps its own set. */
function stateDir(env = process.env) {
  return resolveAgentDir(env);
}

function recordFile(stateDirPath, port) {
  return path.join(stateDirPath, `${RECORD_PREFIX}${port}${RECORD_SUFFIX}`);
}

function logFile(stateDirPath, port) {
  return path.join(stateDirPath, `ompdesk-daemon-${port}.log`);
}

function createControlToken() {
  return randomBytes(24).toString("hex");
}

/**
 * Write through a temporary file and rename, so a reader never sees half a
 * record. The file carries the control token, so it is written owner-only.
 */
function writeRecord(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

function readRecord(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function removeRecord(file) {
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if (error && error.code !== "ENOENT") throw error;
  }
}

/** Every record in the state directory, ordered by port. The port selects an instance. */
function listRecords(stateDirPath) {
  let names;
  try {
    names = fs.readdirSync(stateDirPath);
  } catch {
    return [];
  }
  const records = [];
  for (const name of names) {
    if (!name.startsWith(RECORD_PREFIX) || !name.endsWith(RECORD_SUFFIX)) continue;
    const record = readRecord(path.join(stateDirPath, name));
    if (record && Number.isInteger(record.port)) records.push(record);
  }
  return records.sort((left, right) => left.port - right.port);
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return Boolean(error && error.code === "EPERM");
  }
}

/** TCP connect probe: the port answers, or it does not. */
function probePort(host, port, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (reachable) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

/**
 * Wait until the port reaches the wanted state.
 *
 * `open` picks the direction: waiting for the server to come up, or for it to
 * release the port after a stop.
 */
async function waitForPort(host, port, timeoutMs, open) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probePort(host, port) === open) return true;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  return false;
}

function buildUrl(host, port) {
  return `http://${host}:${port}`;
}

/** Read the live activity view from the running instance, or null when it does not answer. */
async function fetchActivity(record, timeoutMs = 5_000) {
  if (!record || !record.url || !record.controlToken) return null;
  try {
    const response = await fetch(`${record.url}/api/control/activity`, {
      headers: { [CONTROL_TOKEN_HEADER]: record.controlToken },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * End the recorded process and everything it spawned.
 *
 * The daemon starts detached so a closing terminal cannot reach it, which also
 * means killing the recorded pid alone can leave the server it spawned holding
 * the port: `taskkill /T` walks the child tree on Windows, and on POSIX the
 * detached start makes the daemon the leader of a process group that `-pid`
 * reaches. Windows has no SIGTERM, so `/F` is unconditional there instead of
 * looking like a graceful stop that silently does nothing.
 */
function terminateInstance(pid, force) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  const signal = force ? "SIGKILL" : "SIGTERM";
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone: the port probe decides whether anything is left.
    }
  }
}

/** Split a session path into the label a person recognises: the last directory name. */
function projectLabel(projectPath) {
  const normalized = String(projectPath ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  const segment = normalized.slice(normalized.lastIndexOf("/") + 1);
  return segment || normalized || "(unknown)";
}

function describeActivity(activity) {
  if (!activity || !Array.isArray(activity.projects) || activity.projects.length === 0) {
    return ["No sessions yet."];
  }
  return activity.projects.map((project) => {
    const parts = [`${project.sessions} session${project.sessions === 1 ? "" : "s"}`];
    if (project.running > 0) parts.push(`${project.running} running`);
    if (project.waiting > 0) parts.push(`${project.waiting} waiting for input`);
    return `${projectLabel(project.path)}: ${parts.join(", ")}`;
  });
}

function formatStatus(record, activity) {
  if (!record) return ["ompdesk is not running."];

  const lines = [
    `ompdesk is running at ${record.url}`,
    `pid ${record.pid}, started ${record.startedAt}`,
  ];
  if (!activity) {
    lines.push("Session state is unavailable: the instance did not answer the control endpoint.");
    return lines;
  }
  lines.push(...describeActivity(activity));
  return lines;
}

/** Stop refuses while any session is mid-turn; `--force` is the explicit override. */
function stopRefusal(activity) {
  if (!activity) {
    return "Session state is unavailable, so ompdesk cannot tell whether a task is running. Re-run with --force to stop anyway.";
  }
  if (!Number.isInteger(activity.running) || activity.running <= 0) return null;
  const label = activity.running === 1 ? "task is" : "tasks are";
  return `${activity.running} ${label} still running. Wait for them to finish, or re-run with --force to interrupt.`;
}

module.exports = {
  CONTROL_TOKEN_HEADER,
  buildUrl,
  createControlToken,
  describeActivity,
  fetchActivity,
  formatStatus,
  isProcessAlive,
  listRecords,
  logFile,
  probePort,
  projectLabel,
  readRecord,
  recordFile,
  removeRecord,
  stateDir,
  stopRefusal,
  terminateInstance,
  waitForPort,
  writeRecord,
};
