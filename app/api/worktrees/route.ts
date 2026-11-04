import { NextResponse } from "next/server";
import { withRequestLog } from "@/lib/api-request-log";
import { auditFailure, auditSuccess } from "@/lib/audit-log";
import { existsSync } from "fs";
import { ensureWorktree, listBranches, listWorktrees, removeWorktree, resolveProject } from "@/lib/worktree";
import type { BranchInfo, WorktreeInfo } from "@/lib/worktree";
import { allowFileRoot, getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

/** Same gate as /api/files: only session cwds / project roots / explicitly
 *  allowed dirs may be inspected or mutated through this endpoint. */
async function checkCwdAllowed(cwd: string): Promise<NextResponse | null> {
  const allowedRoots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, allowedRoots) || !isExistingFilePathAllowed(cwd, allowedRoots)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  return null;
}

// GET /api/worktrees?cwd=  →  { projectRoot, isGit, isTopLevel, worktrees }
export const GET = withRequestLog("/api/worktrees", getRouteHandler);

async function getRouteHandler(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  try {
    const cwd = new URL(req.url).searchParams.get("cwd");
    if (!cwd) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    const denied = await checkCwdAllowed(cwd);
    if (denied) return denied;

    const project = await resolveProject(cwd);
    let worktrees: WorktreeInfo[] = [];
    let branches: BranchInfo[] | null = [];
    let isGit = true;
    // For a removed-worktree cwd (session of a deleted worktree), fall back
    // to the inferred project root so the switcher still shows the project.
    const listCwd = existsSync(cwd) ? cwd : project.projectRoot;
    try {
      worktrees = await listWorktrees(listCwd);
    } catch {
      isGit = false;
    }
    // Branch enumeration failing must not discard the checkouts that loaded, but
    // the UI needs to tell "no branches" from "could not read branches".
    if (isGit) {
      branches = await listBranches(listCwd, worktrees).catch(() => null);
    }
    // Every listed path is a git-verified worktree of this project; allow the
    // file explorer to browse them even before they have any session (the
    // in-memory allowlist from addWorktree does not survive server restarts).
    for (const w of worktrees) allowFileRoot(w.path);
    return NextResponse.json({
      projectRoot: project.projectRoot,
      isGit,
      isTopLevel: project.isTopLevel,
      worktrees,
      branches,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/worktrees  body: { cwd, branch }  →  { path, branch, reused }
// Ensures a checkout for the branch: reuses the existing one, creates one
// otherwise.
export const POST = withRequestLog("/api/worktrees", async (req: Request) => {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let cwd: string | undefined;
  let branch: string | undefined;
  try {
    const body = await req.json() as { cwd?: string; branch?: string; create?: boolean };
    cwd = body.cwd;
    branch = body.branch;
    if (!body.cwd || typeof body.cwd !== "string") {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (!body.branch || typeof body.branch !== "string") {
      return NextResponse.json({ error: "branch is required" }, { status: 400 });
    }
    const denied = await checkCwdAllowed(body.cwd);
    if (denied) {
      auditFailure("worktree.create", body.branch, { status: 403, cwd: body.cwd });
      return denied;
    }
    if (!existsSync(body.cwd)) {
      auditFailure("worktree.create", body.branch, { status: 400, cwd: body.cwd });
      return NextResponse.json({ error: `Directory does not exist: ${body.cwd}` }, { status: 400 });
    }

    const result = await ensureWorktree(body.cwd, body.branch, { createBranch: body.create === true });
    auditSuccess(result.reused ? "worktree.reuse" : "worktree.create", result.path, { cwd: body.cwd, branch: body.branch });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    auditFailure("worktree.create", branch ?? cwd, { status: 400, cwd, branch, error });
    return NextResponse.json({ error: message }, { status: 400 });
  }
});

// DELETE /api/worktrees  body: { cwd, path, force? }
export const DELETE = withRequestLog("/api/worktrees", async (req: Request) => {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let cwd: string | undefined;
  let worktreePath: string | undefined;
  try {
    const body = await req.json() as { cwd?: string; path?: string; force?: boolean };
    cwd = body.cwd;
    worktreePath = body.path;
    if (!body.cwd || typeof body.cwd !== "string") {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (!body.path || typeof body.path !== "string") {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }
    const denied = await checkCwdAllowed(body.cwd);
    if (denied) {
      auditFailure("worktree.remove", body.path, { status: 403, cwd: body.cwd });
      return denied;
    }

    await removeWorktree(body.cwd, body.path, body.force === true);
    auditSuccess("worktree.remove", body.path, { cwd: body.cwd, force: body.force === true });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // git refuses to remove dirty worktrees without --force; surface that so
    // the UI can offer a force-remove confirmation.
    const dirty = /contains modified or untracked files|is dirty/i.test(message);
    auditFailure("worktree.remove", worktreePath ?? cwd, {
      status: dirty ? 409 : 400,
      cwd,
      dirty,
      error,
    });
    return NextResponse.json({ error: message, dirty }, { status: dirty ? 409 : 400 });
  }
});
