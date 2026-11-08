"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isIP } = require("net");

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function isEnabled(value) {
  return typeof value === "string" && TRUE_VALUES.has(value.trim().toLowerCase());
}

function isLoopbackHostname(hostname) {
  const value = String(hostname).trim().toLowerCase();
  if (value === "localhost" || value === "::1" || value === "[::1]") return true;
  return isIP(value) === 4 && value.startsWith("127.");
}

/**
 * ompdesk listens on the loopback interface and nowhere else, so that reaching
 * the port stays restricted to processes on this machine. Remote devices go
 * through a Tailscale forward of that loopback port (docs/deployment.md).
 *
 * A container is the one caller that needs `0.0.0.0`: its own network namespace
 * is unreachable otherwise, while the host still publishes the port to
 * loopback. The image opts in with OMPDESK_ALLOW_NON_LOOPBACK.
 *
 * Returns the message to print instead of starting, or null when allowed.
 */
function loopbackBindingError(hostname, env = process.env) {
  if (isLoopbackHostname(hostname)) return null;
  if (isEnabled(env.OMPDESK_ALLOW_NON_LOOPBACK)) return null;
  return [
    `ompdesk only listens on the loopback interface; refusing to bind ${hostname}.`,
    "Drop --hostname / OMPDESK_HOSTNAME, or use the address 127.0.0.1.",
    "Reach it from another device through Tailscale: docs/deployment.md.",
  ].join("\n");
}

const COMMANDS = ["start", "status", "stop", "foreground"];

/**
 * First positional argument selects the command; none means `start`.
 *
 * Exactly one positional is accepted. A second one is a mistake worth reporting
 * rather than ignoring: `ompdesk stop status` reads as one intention and means
 * another.
 */
function readCommand(positionals) {
  const [first, ...rest] = positionals;
  if (rest.length > 0) {
    return { error: `Unexpected argument "${rest.join(" ")}"; one command at a time.` };
  }
  if (!first) return { command: "start" };
  if (COMMANDS.includes(first)) return { command: first };
  return { error: `Unknown command: ${first}. Use ${COMMANDS.join(", ")}.` };
}

/**
 * Unknown options are rejected rather than ignored.
 *
 * With positional commands in play, silently ignoring an unknown flag changes
 * what the command does: `ompdesk --stop` used to parse as no command at all and
 * therefore as `start`, so someone trying to stop the server started another one.
 */
function parseLaunchOptions(args = process.argv.slice(2), env = process.env) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        port:      { type: "string", short: "p" },
        hostname:  { type: "string", short: "H" },
        "no-open": { type: "boolean" },
        // Turns the password lock on for this run and every later one, asking for
        // a password on the terminal when none has been set yet.
        authenticated: { type: "boolean" },
        // Recovery from the machine itself: replaces the stored password without
        // needing the old one.
        "reset-password": { type: "boolean" },
        // `stop --force` interrupts running tasks instead of refusing.
        force: { type: "boolean", short: "f" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: true,
    });
  } catch (error) {
    // `parseArgs` explains the fix at length; keep only the flag it named.
    const message = error instanceof Error ? error.message : String(error);
    const unknown = /Unknown option '([^']+)'/.exec(message);
    const invalid = /Option '([^']+)' argument/.exec(message);
    return withDefaults({
      command: "start",
      env,
      error: unknown
        ? `Unknown option: ${unknown[1]}. Run \`ompdesk --help\` for the supported options.`
        : invalid
          ? `Option ${invalid[1]} needs a value.`
          : message,
    });
  }

  const { values: cliArgs, positionals } = parsed;
  const command = readCommand(positionals);
  if (command.error) {
    return withDefaults({ command: "start", env, error: command.error });
  }

  return withDefaults({
    command: command.command,
    env,
    cliArgs,
    help: Boolean(cliArgs.help),
  });
}

function withDefaults({ command, env, cliArgs = {}, help = false, error }) {
  const options = {
    command,
    force: Boolean(cliArgs.force),
    // Naming a port with `--port` selects one instance; `status` and `stop`
    // otherwise cover every recorded instance. An inherited `PORT` sets the
    // default port for `start`, not which instances the other commands look at.
    portExplicit: cliArgs.port !== undefined,
    port: cliArgs.port ?? env.PORT ?? "30141",
    hostname: cliArgs.hostname ?? env.OMPDESK_HOSTNAME ?? "127.0.0.1",
    openBrowser: !cliArgs["no-open"] && !isEnabled(env.OMPDESK_NO_OPEN),
    authenticated: Boolean(cliArgs.authenticated) || isEnabled(env.OMPDESK_AUTHENTICATED),
    resetPassword: Boolean(cliArgs["reset-password"]),
    help,
  };
  return error ? { ...options, error } : options;
}

module.exports = { parseLaunchOptions, loopbackBindingError };
