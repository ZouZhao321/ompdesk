import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";
import { resolveDistDir } from "./bin/runtime.js";

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as { version: string };
let ompVersion = "unknown";
try {
  const ompPkgPath = join(__dirname, "node_modules/@oh-my-pi/pi-coding-agent/package.json");
  ompVersion = (JSON.parse(readFileSync(ompPkgPath, "utf8")) as { version: string }).version;
} catch {
  /* package not found, use default */
}

/**
 * The omp SDK is published as TypeScript sources and imports `bun:` builtins,
 * so webpack must never try to parse it: every `@oh-my-pi/*` request stays a
 * runtime import that Bun resolves itself.
 *
 * `serverExternalPackages` alone is not enough — it leaves the SDK's own
 * transitive entry points (`@oh-my-pi/pi-ai`, `@oh-my-pi/pi-catalog/...`)
 * inside the bundle — so the rule below is applied unconditionally to the
 * whole scope.
 */
const OMP_SDK_REQUEST = /^@oh-my-pi\//;

const nextConfig: NextConfig = {
  // 产物目录按版本分开：安装只覆盖新包里的文件，上一版服务端运行时写下的路由
  // 缓存会留在安装目录里，共用目录时它会被当成本次构建的预渲染结果返回。分版本
  // 之后旧缓存不可能被读到，启动过程也就不需要清理任何文件。
  // Smoke runs (scripts/smoke-dev.mjs) redirect the build output through the
  // same override.
  distDir: resolveDistDir(version, process.env.OMPDESK_DIST_DIR),
  outputFileTracingRoot: __dirname,
  // The repository manages AGENTS.md itself; `next dev` must not write its own
  // block into that file or create one in a fresh worktree.
  agentRules: false,
  serverExternalPackages: [
    "undici",
    "@oh-my-pi/pi-coding-agent",
    "@oh-my-pi/pi-agent-core",
    "@oh-my-pi/pi-ai",
    "@oh-my-pi/pi-catalog",
    "@oh-my-pi/pi-tui",
    "@oh-my-pi/pi-utils",
  ],
  webpack: (config, { isServer, nextRuntime }) => {
    if (!isServer || nextRuntime === "edge") {
      // instrumentation.ts has a Node-only dynamic import guarded by
      // NEXT_RUNTIME. Webpack still traces it for the browser fallback unless
      // the server-only module is explicitly excluded.
      config.resolve.alias["@/lib/http-dispatcher"] = false;
      return config;
    }
    const externals = Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean);
    config.externals = [
      ({ request }: { request?: string }, callback: (error?: unknown, result?: string) => void) => {
        // `import`, not `commonjs`: the SDK's package exports declare only an
        // `import` condition, so a `require()` of it cannot resolve at all.
        if (request && OMP_SDK_REQUEST.test(request)) return callback(undefined, `import ${request}`);
        return callback();
      },
      ...externals,
    ];
    return config;
  },
  // Allow the dev server to be reached over the loopback interface (the
  // browser tab connects to http://127.0.0.1:30141). The server itself never
  // binds a LAN address, so no other origin belongs here.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
        ],
      },
      {
        source: "/",
        headers: [{ key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" }],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_OMP_VERSION: ompVersion,
  },
};

export default nextConfig;
