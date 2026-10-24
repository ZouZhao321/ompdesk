import { stat } from "fs/promises";
import { withRequestLog } from "@/lib/api-request-log";
import { auditFailure, auditSuccess } from "@/lib/audit-log";
import { resolve } from "path";
import { NextResponse } from "next/server";
import { getAgentDir } from "@oh-my-pi/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { invalidateModelsCache } from "@/lib/models-cache";
import { getProjectTrustStatus, trustProject, untrustProject } from "@/lib/project-trust";
import { destroyRpcSessionsForCwd, hasBusyRpcSessionForCwd } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

async function validateCwd(value: unknown): Promise<
  { cwd: string } | { response: NextResponse }
> {
  if (typeof value !== "string" || !value.trim()) {
    return { response: NextResponse.json({ error: "cwd required" }, { status: 400 }) };
  }

  const cwd = resolve(value);
  try {
    if (!(await stat(cwd)).isDirectory()) {
      return { response: NextResponse.json({ error: "cwd must be a directory" }, { status: 400 }) };
    }
  } catch {
    return { response: NextResponse.json({ error: "Directory does not exist" }, { status: 400 }) };
  }

  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return { response: NextResponse.json({ error: "Access denied" }, { status: 403 }) };
  }
  return { cwd };
}

export const GET = withRequestLog("/api/project-trust", getRouteHandler);

async function getRouteHandler(req: Request) {
  const result = await validateCwd(new URL(req.url).searchParams.get("cwd"));
  if ("response" in result) return result.response;
  return NextResponse.json(getProjectTrustStatus(result.cwd, getAgentDir()));
}

export const POST = withRequestLog("/api/project-trust", async (req: Request) => {
  let target: string | undefined;
  try {
    const body = await req.json() as { cwd?: unknown };
    target = typeof body.cwd === "string" ? body.cwd : undefined;
    const result = await validateCwd(body.cwd);
    if ("response" in result) {
      auditFailure("project-trust.grant", target, { status: result.response.status });
      return result.response;
    }

    const agentDir = getAgentDir();
    const current = getProjectTrustStatus(result.cwd, agentDir);
    if (!current.requiresTrust) {
      auditFailure("project-trust.grant", result.cwd, { status: 409, reason: "nothing-to-trust" });
      return NextResponse.json({ error: "This project has no resources that require trust" }, { status: 409 });
    }
    if (hasBusyRpcSessionForCwd(result.cwd)) {
      auditFailure("project-trust.grant", result.cwd, { status: 409, reason: "busy-session" });
      return NextResponse.json({ error: "Wait for the active session to finish before trusting this project" }, { status: 409 });
    }

    const status = trustProject(result.cwd, agentDir);
    invalidateModelsCache();
    await destroyRpcSessionsForCwd(result.cwd);
    auditSuccess("project-trust.grant", result.cwd);
    return NextResponse.json(status);
  } catch (error) {
    auditFailure("project-trust.grant", target, { status: 500, error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
});

export const DELETE = withRequestLog("/api/project-trust", async (req: Request) => {
  let target: string | undefined;
  try {
    const body = await req.json() as { cwd?: unknown };
    target = typeof body.cwd === "string" ? body.cwd : undefined;
    const result = await validateCwd(body.cwd);
    if ("response" in result) {
      auditFailure("project-trust.revoke", target, { status: result.response.status });
      return result.response;
    }
    if (hasBusyRpcSessionForCwd(result.cwd)) {
      auditFailure("project-trust.revoke", result.cwd, { status: 409, reason: "busy-session" });
      return NextResponse.json(
        { error: "Wait for the active session to finish before revoking trust for this project" },
        { status: 409 },
      );
    }

    const status = untrustProject(result.cwd, getAgentDir());
    invalidateModelsCache();
    await destroyRpcSessionsForCwd(result.cwd);
    auditSuccess("project-trust.revoke", result.cwd);
    return NextResponse.json(status);
  } catch (error) {
    auditFailure("project-trust.revoke", target, { status: 500, error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
});
