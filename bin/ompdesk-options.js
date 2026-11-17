"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isIP } = require("net");

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

const DEFAULT_PORT = "30141";

function isEnabled(value) {
  return typeof value === "string" && TRUE_VALUES.has(value.trim().toLowerCase());
}

function isLoopbackHostname(hostname) {
  const value = String(hostname).trim().toLowerCase();
  if (value === "localhost" || value === "::1" || value === "[::1]") return true;
  return isIP(value) === 4 && value.startsWith("127.");
}

/**
 * 客户端真正能连上的主机。
 *
 * `0.0.0.0` 与 `::` 是「监听所有地址」的写法，本身不是可连接的目标：监听它们的
 * 服务从回环地址访问。IPv6 方括号属于 URL 语法而不是套接字语法，这里一并去掉，
 * 让 `[::1]` 与 `::1` 得到同一个主机。
 */
function connectableHost(hostname) {
  const bare = String(hostname ?? "").replace(/^\[|\]$/g, "");
  if (bare === "" || bare === "0.0.0.0" || bare === "::") return "127.0.0.1";
  return bare;
}

/** 打开浏览器用的地址：IPv6 字面量要加方括号，`--host ::1` 才拼得出合法 URL。 */
function browserUrl(hostname, port) {
  const host = connectableHost(hostname);
  return `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
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
 * Explain a `parseArgs` rejection without echoing its whole paragraph.
 *
 * `ERR_PARSE_ARGS_INVALID_OPTION_VALUE` covers two different mistakes that need
 * different advice — a string option with no value, and a boolean flag given one
 * (`--no-open=true`) — so the message decides which. The regexes also keep this
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
 * Unknown options are rejected rather than ignored: a silently dropped
 * `--authenticated` starts an unlocked server on a network that was asked to be
 * locked.
 *
 * Positional arguments are rejected too. The launcher only ever runs the server
 * in this terminal, so a word here is a leftover from a command that no longer
 * exists; saying so beats starting a server the caller did not ask for.
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
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: true,
    });
  } catch (error) {
    return withDefaults({ error: describeParseError(error), env });
  }

  const { values: cliArgs, positionals } = parsed;

  if (positionals.length > 0) {
    return withDefaults({
      error: `Unexpected argument "${positionals.join(" ")}"; ompdesk takes options only. Run \`ompdesk --help\`.`,
      env,
    });
  }

  return withDefaults({
    env,
    cliArgs,
    help: Boolean(cliArgs.help),
  });
}

function withDefaults({ env, cliArgs = {}, help = false, error }) {
  const options = {
    port: cliArgs.port ?? env.PORT ?? DEFAULT_PORT,
    hostname: cliArgs.hostname ?? env.OMPDESK_HOSTNAME ?? "127.0.0.1",
    openBrowser: !cliArgs["no-open"] && !isEnabled(env.OMPDESK_NO_OPEN),
    authenticated: Boolean(cliArgs.authenticated) || isEnabled(env.OMPDESK_AUTHENTICATED),
    resetPassword: Boolean(cliArgs["reset-password"]),
    help,
  };
  return error ? { ...options, error } : options;
}

function usageText() {
  return [
    "Usage: ompdesk [options]",
    "",
    "Starts the server in this terminal and stays attached to it.",
    "",
    "Options:",
    `  -p, --port <port>       Listen port (default ${DEFAULT_PORT}).`,
    "  -H, --hostname <host>   Listen address; non-loopback values are refused unless allowed.",
    "      --no-open           Do not open the browser.",
    "      --authenticated     Turn the password lock on, now and for later runs.",
    "      --reset-password    Replace the stored password without knowing the old one.",
    "  -h, --help              Show this message.",
  ].join("\n");
}

module.exports = {
  DEFAULT_PORT,
  parseLaunchOptions,
  loopbackBindingError,
  usageText,
  connectableHost,
  browserUrl,
};
