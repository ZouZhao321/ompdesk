#!/usr/bin/env bun
// Builds the desktop server payload in src-tauri/server/ with production-only
// dependencies, so the Tauri bundle carries neither devDependencies nor the
// webpack/dev caches (those made the first .app ~4.4GB).
//
// Layout produced (src-tauri/server is gitignored):
//   server/.next            production build, distDir via OMP_WEB_DIST_DIR
//   server/node_modules     bun install --production --frozen-lockfile
//   server/bin public next.config.ts package.json bun.lock
//   server/bun-<triple>     Bun runtime(s) for this platform only
//
// The tauri.conf.json resources map points at ./server/*; the Bun binaries
// are declared per-platform (tauri.macos.conf.json / tauri.windows.conf.json,
// merged via JSON Merge Patch), so a bundle never carries a foreign runtime.
//
// Usage: bun scripts/stage-desktop.mjs [--skip-build]

import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const server = join(root, "src-tauri", "server");
const skipBuild = process.argv.includes("--skip-build");

// 1. clean slate
rmSync(server, { recursive: true, force: true });
mkdirSync(server, { recursive: true });

// 2. static payload
for (const entry of ["bin", "public", "next.config.ts", "package.json", "bun.lock"]) {
  cpSync(join(root, entry), join(server, entry), { recursive: true });
}

// 3. production build straight into the staging dir (the dev `.next/` is
//    never touched, so desktop builds cannot disturb `bun run dev`)
if (!skipBuild) {
  const build = spawnSync("bun", ["run", "build"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, OMP_WEB_DIST_DIR: "src-tauri/server/.next" },
  });
  if (build.status !== 0) {
    console.error("[stage-desktop] next build failed");
    process.exit(build.status ?? 1);
  }
}
if (!existsSync(join(server, ".next", "BUILD_ID"))) {
  console.error("[stage-desktop] production build missing — run without --skip-build first");
  process.exit(1);
}

// 4. drop caches from the staged output (regenerated on the next build)
rmSync(join(server, ".next", "cache"), { recursive: true, force: true });
rmSync(join(server, ".next", "dev"), { recursive: true, force: true });

// 5. production-only dependencies. jiti and the other build tooling stay in
//    devDependencies: Next 16 loads next.config.ts without them, and the
//    only jiti users are the test files, which never ship.
const install = spawnSync("bun", ["install", "--production", "--frozen-lockfile"], {
  cwd: server,
  stdio: "inherit",
});
if (install.status !== 0) {
  console.error("[stage-desktop] production dependency install failed");
  process.exit(install.status ?? 1);
}

// 6. Bun runtime for this platform (macOS bundles both archs — universal app)
const triples =
  process.platform === "win32" ? ["windows-x64"] : ["darwin-aarch64", "darwin-x64"];
const resources = join(root, "src-tauri", "resources");
for (const triple of triples) {
  const name = triple === "windows-x64" ? "bun-windows-x64.exe" : `bun-${triple}`;
  const src = join(resources, name);
  if (!existsSync(src)) {
    console.error(`[stage-desktop] missing ${src} — run \`bun run desktop:fetch-bun\` first`);
    process.exit(1);
  }
  const dest = join(server, name);
  cpSync(src, dest);
  if (process.platform !== "win32") chmodSync(dest, 0o755);
}

// 7. report
if (process.platform !== "win32") {
  const size = spawnSync("du", ["-sh", server], { encoding: "utf8" });
  console.log(`[stage-desktop] payload ready (${(size.stdout ?? "").trim()})`);
} else {
  console.log("[stage-desktop] payload ready");
}
