import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  DEFAULT_PORT,
  parseLaunchOptions,
  loopbackBindingError,
  usageText,
  connectableHost,
  browserUrl,
} = require("../bin/ompdesk-options.js");

test("opens the browser by default", () => {
  assert.deepEqual(parseLaunchOptions([], {}), {
    port: "30141",
    hostname: "127.0.0.1",
    openBrowser: true,
    authenticated: false,
    resetPassword: false,
    help: false,
  });
});

test("rejects unknown options instead of ignoring them", () => {
  const options = parseLaunchOptions(["--stop"], {});
  assert.match(options.error, /Unknown option: --stop/);
});

test("rejects a positional argument, which would otherwise start a server nobody asked for", () => {
  for (const args of [["status"], ["stop"], ["foreground"], ["start", "--no-open"]]) {
    const options = parseLaunchOptions(args, {});
    assert.match(options.error, /takes options only/);
    assert.equal(options.port, "30141", "a rejected command must not change the parsed options");
  }
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

test("asks for help without starting anything", () => {
  for (const flag of ["-h", "--help"]) {
    const options = parseLaunchOptions([flag], {});
    assert.equal(options.help, true);
    assert.equal(options.error, undefined);
  }
});

test("usage text describes options only", () => {
  const usage = usageText();
  assert.match(usage, /^Usage: ompdesk \[options\]$/m);
  assert.match(usage, new RegExp(`default ${DEFAULT_PORT}`));
  for (const flag of ["--force", "status", "stop", "foreground"]) {
    assert.equal(usage.includes(flag), false, `${flag} 已不再是启动器的入口`);
  }
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
  assert.deepEqual(parseLaunchOptions(["-p", "8080", "-H", "0.0.0.0"], {}), {
    port: "8080",
    hostname: "0.0.0.0",
    openBrowser: true,
    authenticated: false,
    resetPassword: false,
    help: false,
  });
});

test("supports OMPDESK_HOSTNAME without trusting the ambient system HOSTNAME", () => {
  assert.equal(parseLaunchOptions([], { HOSTNAME: "container-id" }).hostname, "127.0.0.1");
  assert.equal(parseLaunchOptions([], { OMPDESK_HOSTNAME: "0.0.0.0" }).hostname, "0.0.0.0");
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
  assert.match(loopbackBindingError("0.0.0.0", { OMPDESK_ALLOW_NON_LOOPBACK: "0" }), /refusing to bind/);
});

test("brackets an IPv6 literal so the browser gets a valid URL", () => {
  // `new URL("http://::1:30141")` 抛 ERR_INVALID_URL：方括号是 URL 语法的一部分。
  assert.equal(browserUrl("::1", 30141), "http://[::1]:30141");
  assert.equal(browserUrl("[::1]", DEFAULT_PORT), `http://[::1]:${DEFAULT_PORT}`);
  assert.equal(new URL(browserUrl("::1", DEFAULT_PORT)).hostname, "[::1]");
});

test("reaches a wildcard listener over loopback", () => {
  // `0.0.0.0` / `::` 是监听范围，不是可连接的目标；浏览器访问它们不会命中服务。
  assert.equal(browserUrl("0.0.0.0", 30141), "http://127.0.0.1:30141");
  assert.equal(browserUrl("::", 30141), "http://127.0.0.1:30141");
  assert.equal(connectableHost("::"), "127.0.0.1");
});

test("keeps an ordinary IPv4 address as the open address", () => {
  assert.equal(browserUrl("127.0.0.1", 8080), "http://127.0.0.1:8080");
  assert.equal(browserUrl("127.0.0.2", 8080), "http://127.0.0.2:8080");
});

test("builds the open address from a hostname untouched", () => {
  assert.equal(connectableHost("localhost"), "localhost");
  assert.equal(browserUrl("example.internal", 8443), "http://example.internal:8443");
  assert.equal(connectableHost(""), "127.0.0.1");
});
