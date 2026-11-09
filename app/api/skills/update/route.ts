import { NextResponse } from "next/server";
import { getAgentDir } from "@oh-my-pi/pi-coding-agent";
import { runNpx, getSafeNpxEnv, redactNpxOutput } from "@/lib/npx";
import type { SkillInstallScope } from "@/lib/api-types";
import { buildSkillUpdateArgs } from "@/lib/skill-updates";
import { loadSkillsWithInstallInfo } from "@/lib/skills-service";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { withRequestLog } from "@/lib/api-request-log";
import { auditFailure, auditSuccess } from "@/lib/audit-log";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getProjectTrustStatus } from "@/lib/project-trust";
export const dynamic = "force-dynamic";

export const POST = withRequestLog("/api/skills/update", async (req: Request) => {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let cwd = "";
  let pkg = "";
  let skillScope: SkillInstallScope | undefined;
  try {
    const body = (await req.json()) as {
      cwd?: unknown;
      package?: unknown;
      scope?: unknown;
    };
    cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    pkg = typeof body.package === "string" ? body.package.trim() : "";
    skillScope = body.scope === "global" || body.scope === "project" ? (body.scope as SkillInstallScope) : undefined;
    if (!cwd || !pkg || !skillScope) {
      auditFailure("skill.update", pkg || undefined, { status: 400, cwd: cwd || undefined, scope: skillScope });
      return NextResponse.json({ error: "cwd, package, and scope are required" }, { status: 400 });
    }
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      auditFailure("skill.update", pkg, { status: 403, cwd, scope: skillScope });
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    if (skillScope === "project" && !getProjectTrustStatus(cwd, getAgentDir()).trusted) {
      auditFailure("skill.update", pkg, { status: 403, cwd, scope: skillScope, reason: "untrusted-project" });
      return NextResponse.json(
        { error: "Project resources must be trusted before updating project skills" },
        { status: 403 },
      );
    }

    const { skills } = await loadSkillsWithInstallInfo(cwd);
    const skill = skills.find((item) => item.install?.package === pkg && item.install.scope === skillScope);
    if (!skill?.install) {
      auditFailure("skill.update", pkg, { status: 404, cwd, scope: skillScope, reason: "not-installed" });
      return NextResponse.json({ error: "Installed skill not found" }, { status: 404 });
    }
    if (!skill.install.canCheckForUpdates) {
      auditFailure("skill.update", pkg, { status: 400, cwd, scope: skillScope, reason: "not-updatable" });
      return NextResponse.json({ error: "This skill cannot be updated automatically" }, { status: 400 });
    }

    const { stdout, stderr } = await runNpx(buildSkillUpdateArgs(skill.install), {
      timeout: 60_000,
      cwd: skillScope === "project" ? cwd : undefined,
      env: getSafeNpxEnv({ FORCE_COLOR: "0" }),
    });

    const refreshed = await loadSkillsWithInstallInfo(cwd);
    const updatedSkill = refreshed.skills.find(
      (item) => item.install?.package === pkg && item.install.scope === skillScope,
    );
    auditSuccess("skill.update", pkg, { cwd, scope: skillScope });
    return NextResponse.json({
      success: true,
      skill: updatedSkill,
      output: redactNpxOutput(`${stdout}${stderr}`).slice(-1000),
    });
  } catch (error: unknown) {
    const detail = error as { stdout?: string; stderr?: string; message?: string };
    const output = redactNpxOutput(`${detail.stdout ?? ""}${detail.stderr ?? ""}`).slice(-1000);
    auditFailure("skill.update", pkg || undefined, {
      status: 500,
      cwd: cwd || undefined,
      scope: skillScope,
      error: detail.message ?? "update-failed",
    });
    return NextResponse.json({ error: output || "Skill update failed" }, { status: 500 });
  }
});
