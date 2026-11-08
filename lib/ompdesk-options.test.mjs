import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { parseLaunchOptions, loopbackBindingError } = require("../bin/ompdesk-options.js");

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
  assert.equal(options.command, "start");
  assert.match(options.error, /Unknown option: --stop/);
});

test("rejects a second command instead of silently ignoring it", () => {
  const options = parseLaunchOptions(["stop", "status"], {});
  assert.match(options.error, /one command at a time/);
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
