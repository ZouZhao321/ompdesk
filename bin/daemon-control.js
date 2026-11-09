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
const http = require("http");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const net = require("net");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveAgentDir } = require("./web-auth-store");

const RECORD_PREFIX = "ompdesk-daemon-";
const RECORD_SUFFIX = ".json";
// Kept in step with `CONTROL_TOKEN_HEADER` in lib/control-token.ts: the launcher
// cannot import TypeScript (it loads before Bun is resolved), so the wire name
// is written twice and the two spellings have to match.
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
  return path.join(stateDirPath, `${RECORD_PREFIX}${port}.log`);
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

/**
 * Every usable record in the state directory, ordered by port.
 *
 * A record without a port or a host is unreadable rather than merely idle:
 * every caller probes or prints `host`, so keeping it would turn `status` into a
 * TypeError. Unusable records are dropped here instead.
 */
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
    if (!record) continue;
    if (!Number.isInteger(record.port) || typeof record.host !== "string" || record.host === "") continue;
    records.push(record);
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

/**
 * The address a client can actually connect to.
 *
 * `0.0.0.0` / `::` mean "listen everywhere" and are not connect targets; a
 * record written from `-H 0.0.0.0` is reached over loopback instead. IPv6
 * brackets are URL syntax, not socket syntax, so they come off here.
 */
function connectableHost(host) {
  const bare = String(host ?? "").replace(/^\[|\]$/g, "");
  if (bare === "0.0.0.0" || bare === "::" || bare === "") return "127.0.0.1";
  return bare;
}
/** TCP connect probe: the port answers, or it does not. */
function probePort(host, port, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: connectableHost(host), port });
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
 * `expectOpen` picks the direction: waiting for the server to come up, or for
 * the port to be released after a stop.
 */
async function waitForPort(host, port, timeoutMs, expectOpen) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await probePort(host, port)) === expectOpen) return true;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  return false;
}

/** IPv6 hosts need brackets in a URL; the loopback check accepts `::1` and `[::1]`. */
function buildUrl(host, port) {
  const bare = connectableHost(host);
  const bracketed = bare.includes(":") ? `[${bare}]` : bare;
  return `http://${bracketed}:${port}`;
}

/**
 * Read the live activity view from the running instance.
 *
 * `node:http` rather than `fetch`: `fetch` honours `HTTP_PROXY`, and the
 * launcher's own environment never went through `withLoopbackNoProxy`, so an
 * operator with a proxy configured would have every control call fail even
 * though the server is on loopback and answering.
 */
function fetchActivity(record, timeoutMs = 5_000) {
  if (!record || !record.host || !record.port || !record.controlToken) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const request = http.request(
      {
        hostname: connectableHost(record.host),
        port: record.port,
        path: "/api/control/activity",
        headers: { [CONTROL_TOKEN_HEADER]: record.controlToken },
        timeout: timeoutMs,
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          finish(null);
          return;
        }
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          try {
            finish(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            finish(null);
          }
        });
        response.on("error", () => finish(null));
      },
    );

    request.on("error", () => finish(null));
    request.on("timeout", () => {
      request.destroy();
      finish(null);
    });
    request.end();
  });
}

/**
 * End the recorded process and everything it spawned.
 *
 * The daemon starts detached so a closing terminal cannot reach it, which also
 * means killing the recorded pid alone can leave the server it spawned holding
 * the port: `taskkill /T` walks the child tree on Windows, and on POSIX the
 * detached start makes the daemon the leader of a process group that `-pid`
 * reaches. Windows has no SIGTERM, so both paths there end the tree with `/F`;
 * `--force` still changes the outcome by skipping the running-task check in
 * `runStop`, which is the part a person is choosing between.
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

/**
 * Last path segment, which is what a person calls the project.
 *
 * `projectDisplayName` in lib/project-order.ts is the shared version, but that
 * module is TypeScript and this file loads before Bun is resolved. The rule is
 * two lines, so it stays duplicated here rather than forcing a build step.
 */
function projectLabel(projectPath) {
  const raw = String(projectPath ?? "").replace(/\\/g, "/");
  // The filesystem root keeps its slash: stripping it would leave an empty name
  // and print "(unknown)" for a project that does have a name.
  if (raw === "/") return "/";
  const trimmed = raw.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed || "(unknown)";
}

function describeActivity(activity) {
  if (!activity) return ["No sessions yet."];
  if (!Array.isArray(activity.projects)) {
    // The rows are missing but the totals may still be known; saying "no
    // sessions" here would contradict the refusal `stop` is making.
    const lines = [];
    if (activity.running > 0) lines.push(`${activity.running} running`);
    if (activity.waiting > 0) lines.push(`${activity.waiting} waiting for input`);
    return lines.length > 0 ? [`State incomplete: ${lines.join(", ")}.`] : ["No sessions yet."];
  }

  const lines = activity.projects.map((project) => {
    const parts = [`${project.sessions} session${project.sessions === 1 ? "" : "s"}`];
    if (project.running > 0) parts.push(`${project.running} running`);
    if (project.waiting > 0) parts.push(`${project.waiting} waiting for input`);
    return `${projectLabel(project.path)}: ${parts.join(", ")}`;
  });

  // The totals come from the runtime snapshot, the rows from the session list. A
  // turn can be busy before its session is placeable, and `stop` refuses for it —
  // say so here instead of leaving the two numbers to disagree with no reason.
  // Only the difference is printed, so a quiet instance stays one line.
  const placedRunning = activity.projects.reduce((total, project) => total + (project.running ?? 0), 0);
  const placedWaiting = activity.projects.reduce((total, project) => total + (project.waiting ?? 0), 0);
  const unplaced = [];
  const unplacedRunning = (activity.running ?? 0) - placedRunning;
  const unplacedWaiting = (activity.waiting ?? 0) - placedWaiting;
  if (unplacedRunning > 0) unplaced.push(`${unplacedRunning} running`);
  if (unplacedWaiting > 0) unplaced.push(`${unplacedWaiting} waiting for input`);
  if (unplaced.length > 0) {
    const total = unplacedRunning > 0 ? unplacedRunning + (unplacedWaiting > 0 ? unplacedWaiting : 0) : unplacedWaiting;
    const noun = total === 1 ? "session" : "sessions";
    lines.push(`Not listed under a project yet: ${unplaced.join(", ")} ${noun}.`);
  }

  if (lines.length === 0) return ["No sessions yet."];
  return lines;
}

function formatStatus(record, activity) {
  if (!record) return ["ompdesk is not running."];

  const lines = [
    `ompdesk is running at ${record.url}`,
    `pid ${record.pid}, started ${record.startedAt}`,
    `log ${record.log}`,
  ];
  if (!activity) {
    lines.push("Session state is unavailable: the instance did not answer the control endpoint.");
    return lines;
  }
  lines.push(...describeActivity(activity));
  return lines;
}

/** Stop refuses while any session is mid-turn; `--force` is the explicit override. */
const UNKNOWN_TASK_STATE =
  "Session state is unavailable, so ompdesk cannot tell whether a task is running. Re-run with --force to stop anyway.";

/**
 * Should `stop` refuse?
 *
 * Only a well-formed zero allows the stop. A response that omits `running`, or
 * carries something other than a count, means the CLI cannot tell — and an
 * unclear state must not become permission to interrupt work, so it refuses the
 * same way an unreachable endpoint does.
 */
function stopRefusal(activity) {
  if (!activity || !Number.isInteger(activity.running)) return UNKNOWN_TASK_STATE;
  if (activity.running < 0) return UNKNOWN_TASK_STATE;
  if (activity.running === 0) return null;
  const label = activity.running === 1 ? "task is" : "tasks are";
  return `${activity.running} ${label} still running. Wait for them to finish, or re-run with --force to interrupt.`;
}

module.exports = {
  CONTROL_TOKEN_HEADER,
  buildUrl,
  connectableHost,
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
