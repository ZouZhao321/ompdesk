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

function parseLaunchOptions(args = process.argv.slice(2), env = process.env) {
  const { values: cliArgs } = parseArgs({
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
    },
    strict: false,
  });

  return {
    port: cliArgs.port ?? env.PORT ?? "30141",
    hostname: cliArgs.hostname ?? env.OMPDESK_HOSTNAME ?? "127.0.0.1",
    openBrowser: !cliArgs["no-open"] && !isEnabled(env.OMPDESK_NO_OPEN),
    authenticated: Boolean(cliArgs.authenticated) || isEnabled(env.OMPDESK_AUTHENTICATED),
    resetPassword: Boolean(cliArgs["reset-password"]),
  };
}

module.exports = { parseLaunchOptions, loopbackBindingError };
