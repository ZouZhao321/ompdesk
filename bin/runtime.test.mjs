import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { canClearRouteCache, clearStaleRouteCache } = require("./runtime.js");

function withNextDir(run) {
  const root = mkdtempSync(join(tmpdir(), "ompdesk-route-cache-"));
  try {
    const nextDir = join(root, ".next");
    run(nextDir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("clearStaleRouteCache removes the route cache left by a previous install", () => {
  withNextDir((nextDir) => {
    const pageDir = join(nextDir, "server", "route-cache", "APP_PAGE", "index", "$");
    mkdirSync(pageDir, { recursive: true });
    writeFileSync(join(pageDir, "index.html"), "stale build output");

    assert.equal(clearStaleRouteCache(nextDir), true);
    assert.equal(existsSync(join(nextDir, "server", "route-cache")), false);
  });
});

test("clearStaleRouteCache leaves a build that never wrote the cache alone", () => {
  withNextDir((nextDir) => {
    mkdirSync(join(nextDir, "server", "app"), { recursive: true });
    writeFileSync(join(nextDir, "server", "app", "index.html"), "current build output");

    assert.equal(clearStaleRouteCache(nextDir), false);
    assert.equal(existsSync(join(nextDir, "server", "app", "index.html")), true);
  });
});

test("canClearRouteCache keeps the cache while this install serves another port", () => {
  const live = [{ pid: 4242, port: 30141, install: "/opt/ompdesk" }];

  assert.equal(canClearRouteCache(live, "/opt/ompdesk"), false);
});

test("canClearRouteCache ignores instances from another install", () => {
  const live = [{ pid: 4242, port: 30141, install: "/opt/ompdesk-after-upgrade" }];

  assert.equal(canClearRouteCache(live, "/opt/ompdesk"), true);
});

test("canClearRouteCache counts a record without install as this install", () => {
  const live = [{ pid: 4242, port: 30141 }];

  assert.equal(canClearRouteCache(live, "/opt/ompdesk"), false);
});

test("canClearRouteCache clears when nothing else is running", () => {
  assert.equal(canClearRouteCache([], "/opt/ompdesk"), true);
});
