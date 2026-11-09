"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isIP } = require("net");

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

const DEFAULT_PORT = "30141";
const COMMANDS = [
  ["start", "Start in the background and return to the prompt (default)."],
  ["status", "Report each recorded instance: running or not, address, pid, log, per-project sessions."],
  ["stop", "Stop the recorded instances. Refuses while a session is mid-turn."],
  ["foreground", "Run attached to this terminal, for containers and service managers."],
];
const COMMAND_NAMES = COMMANDS.map(([name]) => name);

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

/**
 * First positional argument selects the command; none means `start`.
 *
 * The first positional is checked before the count: `ompdesk bogus status`
 * should say the command is unknown, not complain about the extra word.
 */
function readCommand(positionals) {
  const [first, ...rest] = positionals;
  if (first && !COMMAND_NAMES.includes(first)) {
    return { error: `Unknown command: ${first}. Use ${COMMAND_NAMES.join(", ")}.` };
  }
  if (rest.length > 0) {
    return { error: `Unexpected argument "${rest.join(" ")}"; one command at a time.` };
  }
  return { command: first || "start" };
}

/**
 * Explain a `parseArgs` rejection without echoing its whole paragraph.
 *
 * `ERR_PARSE_ARGS_INVALID_OPTION_VALUE` covers two different mistakes that need
 * different advice — a string option with no value, and a boolean flag given one
 * (`--force=1`) — so the message decides which. The regexes also keep this
 * working on runtimes that omit `code`.
 */
function describeParseError(error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  const message = error instanceof Error ? error.message : String(error);

  const named = /'([^']+)'/.exec(message);
  const flag = named ? named[1] : "?";
  if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" || /Unknown option '[^']+'/.test(message)) {
    return `Unknown option: ${flag}. Run \`ompdesk --help\` for the supported options.`;
  }
  if (/does not take an argument/.test(message)) {
    return `Option ${flag} does not take a value.`;
  }
  if (code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE" || /Option '[^']+' argument/.test(message)) {
    return `Option ${flag} needs a value.`;
  }
  return message;
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
        port: { type: "string", short: "p" },
        hostname: { type: "string", short: "H" },
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
    return withDefaults({ error: describeParseError(error), env });
  }

  const { values: cliArgs, positionals } = parsed;
  const command = readCommand(positionals);
  if (command.error) return withDefaults({ error: command.error, env });

  return withDefaults({
    command: command.command,
    env,
    cliArgs,
    help: Boolean(cliArgs.help),
  });
}

function withDefaults({ command = "start", env, cliArgs = {}, help = false, error }) {
  const options = {
    command,
    force: Boolean(cliArgs.force),
    // Naming a port with `--port` selects one instance; `status` and `stop`
    // otherwise cover every recorded instance. An inherited `PORT` sets the
    // default port for `start`, not which instances the other commands look at.
    portExplicit: cliArgs.port !== undefined,
    port: cliArgs.port ?? env.PORT ?? DEFAULT_PORT,
    hostname: cliArgs.hostname ?? env.OMPDESK_HOSTNAME ?? "127.0.0.1",
    openBrowser: !cliArgs["no-open"] && !isEnabled(env.OMPDESK_NO_OPEN),
    authenticated: Boolean(cliArgs.authenticated) || isEnabled(env.OMPDESK_AUTHENTICATED),
    resetPassword: Boolean(cliArgs["reset-password"]),
    help,
  };
  return error ? { ...options, error } : options;
}

/** Help text, built from the same table the parser accepts commands from. */
function usageText() {
  const commands = COMMANDS.map(([name, summary]) => `  ${name.padEnd(11)} ${summary}`);
  return [
    "Usage: ompdesk [command] [options]",
    "",
    "Commands:",
    ...commands,
    "",
    "Options:",
    `  -p, --port <port>       Listen port (default ${DEFAULT_PORT}); selects one instance for status/stop.`,
    "  -H, --hostname <host>   Listen address; non-loopback values are refused unless allowed.",
    "  -f, --force             With stop: interrupt running tasks instead of refusing.",
    "      --no-open           Do not open the browser.",
    "      --authenticated     Turn the password lock on, now and for later runs.",
    "      --reset-password    Replace the stored password without knowing the old one.",
    "  -h, --help              Show this message.",
  ].join("\n");
}

module.exports = { COMMAND_NAMES, COMMANDS, DEFAULT_PORT, parseLaunchOptions, loopbackBindingError, usageText };
