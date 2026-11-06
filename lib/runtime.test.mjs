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

const [minMajor, minMinor, minPatch] = MIN_BUN_VERSION.split(".").map(Number);

// 从最低版本派生三档更高版本（补丁+1、次版本+1、主版本+1，低位归零）：最低版本上调后
// 这些用例仍然成立，不会写成新的不支持版本。
const versionsAboveMinimum = [
  `${minMajor}.${minMinor}.${minPatch + 1}`,
  `${minMajor}.${minMinor + 1}.0`,
  `${minMajor + 1}.0.0`,
];

// 对应的三档更低版本；低位已经是 0 时该档没有更小版本可构造，置空后滤掉。
const versionsBelowMinimum = [
  minPatch > 0 ? `${minMajor}.${minMinor}.${minPatch - 1}` : null,
  minMinor > 0 ? `${minMajor}.${minMinor - 1}.0` : null,
  minMajor > 0 ? `${minMajor - 1}.0.0` : null,
].filter((version) => version !== null);

test("accepts the minimum supported Bun version and newer versions", () => {
  for (const version of [MIN_BUN_VERSION, `v${MIN_BUN_VERSION}`, ...versionsAboveMinimum]) {
    assert.equal(isBunVersionSupported(version), true, version);
  }
});

test("rejects versions older than the minimum and invalid input", () => {
  for (const version of [...versionsBelowMinimum, "nope", "1.3", "", undefined, null]) {
    assert.equal(isBunVersionSupported(version), false, String(version));
  }
});

test("keeps the package engines aligned with the startup checks", () => {
  assert.equal(packageJson.engines.bun, `>=${MIN_BUN_VERSION}`);
});

test("reports both the required and current Bun versions", () => {
  const current = versionsBelowMinimum[0] ?? "0.0.0";
  const message = getUnsupportedBunVersionMessage(current);
  assert.ok(message.includes(`requires Bun ${MIN_BUN_VERSION} or newer`));
  assert.ok(message.includes(`Current Bun version: ${current}.`));
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

  const proxied = withLoopbackNoProxy({
    HTTPS_PROXY: "http://proxy:3128",
    NO_PROXY: "corp.internal, localhost",
  });
  assert.equal(proxied.NO_PROXY, "corp.internal,localhost,127.0.0.1,::1");
  assert.equal(proxied.no_proxy, proxied.NO_PROXY);

  const wildcard = { HTTP_PROXY: "http://proxy:3128", NO_PROXY: "*" };
  assert.equal(withLoopbackNoProxy(wildcard), wildcard);
});
