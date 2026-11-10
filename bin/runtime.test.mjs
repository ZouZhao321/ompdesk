import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { clearStaleRouteCache } = require("./runtime.js");

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
