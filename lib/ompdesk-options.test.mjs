import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  COMMAND_NAMES,
  DEFAULT_PORT,
  parseLaunchOptions,
  loopbackBindingError,
  usageText,
} = require("../bin/ompdesk-options.js");

test("opens the browser by default", () => {
  assert.deepEqual(parseLaunchOptions([], {}), {
    command: "start",
    force: false,
    portExplicit: false,
    port: "30141",
    hostname: "127.0.0.1",
    openBrowser: true,
    authenticated: false,
    resetPassword: false,
    help: false,
  });
});

test("rejects unknown options instead of falling back to start", () => {
  const options = parseLaunchOptions(["--stop"], {});
  assert.match(options.error, /Unknown option: --stop/);
});

test("rejects a second command instead of silently ignoring it", () => {
  const options = parseLaunchOptions(["stop", "status"], {});
  assert.match(options.error, /one command at a time/);
});

test("reports an unknown command before complaining about extra words", () => {
  const options = parseLaunchOptions(["bogus", "status"], {});
  assert.match(options.error, /Unknown command: bogus/);
});

test("names the option that is missing its value", () => {
  const options = parseLaunchOptions(["--port"], {});
  assert.match(options.error, /--port/);
  assert.match(options.error, /needs a value/);
});

test("a boolean flag given a value is reported as such, not as a missing one", () => {
  const options = parseLaunchOptions(["--no-open=true"], {});
  assert.match(options.error, /--no-open does not take a value/);
});

test("an empty first argument falls back to start rather than an empty command", () => {
  assert.equal(parseLaunchOptions([""], {}).command, "start");
});

test("asks for help without starting anything", () => {
  for (const flag of ["-h", "--help"]) {
    const options = parseLaunchOptions([flag], {});
    assert.equal(options.help, true);
    assert.equal(options.error, undefined);
  }
});

test("usage text is built from the same command list the parser accepts", () => {
  const usage = usageText();
  for (const name of COMMAND_NAMES) assert.match(usage, new RegExp(`^  ${name} `, "m"));
  assert.match(usage, new RegExp(`default ${DEFAULT_PORT}`));
});

test("supports the no-open CLI option", () => {
  assert.equal(parseLaunchOptions(["--no-open"], {}).openBrowser, false);
});

test("supports truthy OMPDESK_NO_OPEN values", () => {
  for (const value of ["1", "true", "TRUE", "yes", "on"]) {
    assert.equal(parseLaunchOptions([], { OMPDESK_NO_OPEN: value }).openBrowser, false);
  }
});

test("does not disable browser opening for false OMPDESK_NO_OPEN values", () => {
  for (const value of ["0", "false", "off", ""]) {
    assert.equal(parseLaunchOptions([], { OMPDESK_NO_OPEN: value }).openBrowser, true);
  }
});

test("preserves port and hostname options", () => {
  assert.deepEqual(
    parseLaunchOptions(["-p", "8080", "-H", "0.0.0.0"], {}),
    {
      command: "start",
      force: false,
      portExplicit: true,
      port: "8080",
      hostname: "0.0.0.0",
      openBrowser: true,
      authenticated: false,
      resetPassword: false,
      help: false,
    },
  );
});

test("supports OMPDESK_HOSTNAME without trusting the ambient system HOSTNAME", () => {
  assert.equal(
    parseLaunchOptions([], { HOSTNAME: "container-id" }).hostname,
    "127.0.0.1",
  );
  assert.equal(
    parseLaunchOptions([], { OMPDESK_HOSTNAME: "0.0.0.0" }).hostname,
    "0.0.0.0",
  );
});

test("forces password access with --authenticated or OMPDESK_AUTHENTICATED", () => {
  assert.equal(parseLaunchOptions(["--authenticated"], {}).authenticated, true);
  for (const value of ["1", "true", "TRUE", "yes", "on"]) {
    assert.equal(parseLaunchOptions([], { OMPDESK_AUTHENTICATED: value }).authenticated, true);
  }
  for (const value of ["0", "false", "off", ""]) {
    assert.equal(parseLaunchOptions([], { OMPDESK_AUTHENTICATED: value }).authenticated, false);
  }
});

test("requests a password reset only from the CLI flag", () => {
  assert.equal(parseLaunchOptions(["--reset-password"], {}).resetPassword, true);
  assert.equal(parseLaunchOptions([], { OMPDESK_RESET_PASSWORD: "1" }).resetPassword, false);
});

test("refuses to bind a non-loopback address", () => {
  for (const hostname of ["0.0.0.0", "192.168.1.9", "100.74.122.38", "example.internal"]) {
    assert.match(loopbackBindingError(hostname, {}), /refusing to bind/);
  }
});

test("allows every loopback spelling", () => {
  for (const hostname of ["127.0.0.1", "127.0.0.2", "localhost", "LOCALHOST", "::1", "[::1]"]) {
    assert.equal(loopbackBindingError(hostname, {}), null);
  }
});

test("lets the container image opt out of the loopback rule", () => {
  assert.equal(loopbackBindingError("0.0.0.0", { OMPDESK_ALLOW_NON_LOOPBACK: "1" }), null);
  assert.match(
    loopbackBindingError("0.0.0.0", { OMPDESK_ALLOW_NON_LOOPBACK: "0" }),
    /refusing to bind/,
  );
});
