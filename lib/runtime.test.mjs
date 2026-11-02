import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
const {
  MIN_BUN_VERSION,
  getMissingBunMessage,
  getUnsupportedBunVersionMessage,
  isBunVersionSupported,
  resolveBunPath,
} = require("../bin/runtime.js");

test("accepts the minimum supported Bun version and newer versions", () => {
  for (const version of [MIN_BUN_VERSION, `v${MIN_BUN_VERSION}`, "1.3.15", "1.4.2", "2.0.0"]) {
    assert.equal(isBunVersionSupported(version), true, version);
  }
});

test("rejects older and invalid Bun versions", () => {
  for (const version of ["1.3.13", "1.2.99", "0.8.1", "nope", "1.3", "", undefined, null]) {
    assert.equal(isBunVersionSupported(version), false, String(version));
  }
});

test("keeps the package engines aligned with the startup checks", () => {
  assert.equal(packageJson.engines.bun, `>=${MIN_BUN_VERSION}`);
});

test("reports both the required and current Bun versions", () => {
  const message = getUnsupportedBunVersionMessage("1.2.99");
  assert.match(message, /requires Bun 1\.3\.14 or newer/);
  assert.match(message, /Current Bun version: 1\.2\.99/);
});

test("explains how to install Bun and how to override its location", () => {
  const message = getMissingBunMessage();
  assert.match(message, /bun\.sh\/install/);
  assert.match(message, /OMPDESK_BUN=/);
});

test("prefers OMPDESK_BUN over PATH lookups", () => {
  const dir = mkdtempSync(join(tmpdir(), "ompdesk-runtime-"));
  try {
    const override = join(dir, "custom-bun");
    writeFileSync(override, "");
    assert.equal(resolveBunPath({ OMPDESK_BUN: override, PATH: "" }), override);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("adds loopback to NO_PROXY only when a proxy is configured", () => {
  const { withLoopbackNoProxy } = require("../bin/runtime.js");

  const plain = { PATH: "/bin" };
  assert.equal(withLoopbackNoProxy(plain), plain);

  const proxied = withLoopbackNoProxy({ HTTPS_PROXY: "http://proxy:3128", NO_PROXY: "corp.internal, localhost" });
  assert.equal(proxied.NO_PROXY, "corp.internal,localhost,127.0.0.1,::1");
  assert.equal(proxied.no_proxy, proxied.NO_PROXY);

  const wildcard = { HTTP_PROXY: "http://proxy:3128", NO_PROXY: "*" };
  assert.equal(withLoopbackNoProxy(wildcard), wildcard);
});
