import { NextResponse } from "next/server";
import { getAgentDir } from "@oh-my-pi/pi-coding-agent";
import { runNpx, getSafeNpxEnv, redactNpxOutput } from "@/lib/npx";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { withRequestLog } from "@/lib/api-request-log";
import { auditFailure, auditSuccess } from "@/lib/audit-log";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getProjectTrustStatus } from "@/lib/project-trust";

export const dynamic = "force-dynamic";

const ANSI_RE = /\x1B\[[0-9;]*m/g;
const SKILL_PACKAGE_RE = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+@[A-Za-z0-9_.-]+$/;
const MAX_SKILL_PACKAGE_LENGTH = 256;

// POST /api/skills/install  body: { package: string; scope: "global" | "project"; cwd?: string }
export const POST = withRequestLog("/api/skills/install", async (req: Request) => {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let pkg = "";
  let scope: unknown;
  let cwd = "";
  try {
    const body = (await req.json()) as { package?: unknown; scope?: unknown; cwd?: unknown };
    pkg = typeof body.package === "string" ? body.package.trim() : "";
    scope = body.scope;
    cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    if (!pkg) {
      auditFailure("skill.install", undefined, { status: 400, reason: "package-required" });
      return NextResponse.json({ error: "package required" }, { status: 400 });
    }
    if (pkg.length > MAX_SKILL_PACKAGE_LENGTH || !SKILL_PACKAGE_RE.test(pkg)) {
      auditFailure("skill.install", undefined, { status: 400, reason: "invalid-package" });
      return NextResponse.json({ error: "package must be a GitHub skill reference" }, { status: 400 });
    }
    if (scope !== "global" && scope !== "project") {
      auditFailure("skill.install", pkg, { status: 400, reason: "invalid-scope" });
      return NextResponse.json({ error: "scope must be global or project" }, { status: 400 });
    }

    const isGlobal = scope === "global";
    if (!isGlobal) {
      if (!cwd) {
        auditFailure("skill.install", pkg, { status: 400, scope, reason: "cwd-required" });
        return NextResponse.json({ error: "cwd required for project install" }, { status: 400 });
      }
      const allowedRoots = await getAllowedFileRoots();
      if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
        auditFailure("skill.install", pkg, { status: 403, scope, cwd });
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
      if (!getProjectTrustStatus(cwd, getAgentDir()).trusted) {
        auditFailure("skill.install", pkg, { status: 403, scope, cwd, reason: "untrusted-project" });
        return NextResponse.json(
          { error: "Project resources must be trusted before installing project skills" },
          { status: 403 },
        );
      }
    }
    const args = ["skills", "add", pkg, "-y", "--agent", "claude-code"];
    if (isGlobal) args.push("-g");

    console.log(`[skills/install] running: npx ${args.join(" ")}`);
    const { stdout, stderr } = await runNpx(args, {
      timeout: 60000,
      cwd: !isGlobal ? cwd : undefined,
      env: getSafeNpxEnv({ FORCE_COLOR: "0" }),
    });

    const output = redactNpxOutput(stdout + stderr)
      .replace(ANSI_RE, "")
      .slice(-4000);
    const success = /Installation complete|Installed \d+ skill/.test(output);
    if (!success) {
      auditFailure("skill.install", pkg, { status: 500, scope, cwd: cwd || undefined, reason: "install-failed" });
      return NextResponse.json({ error: output || "Install failed" }, { status: 500 });
    }
    auditSuccess("skill.install", pkg, { scope, cwd: cwd || undefined });
    return NextResponse.json({ success: true, output });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const output = redactNpxOutput((err.stdout ?? "") + (err.stderr ?? ""))
      .replace(ANSI_RE, "")
      .slice(-4000);
    auditFailure("skill.install", pkg || undefined, {
      status: 500,
      scope,
      cwd: cwd || undefined,
      error: err.message ?? "install-failed",
    });
    return NextResponse.json({ error: output || "Install failed" }, { status: 500 });
  }
});
