import { NextRequest, NextResponse } from "next/server";
import { withRequestLog } from "@/lib/api-request-log";
import { extractCommentEntries } from "@/lib/comment-entries";
import { readCommentSourceFiles } from "@/lib/comment-sources";
import {
  getAllowedFileRoots,
  isExistingFilePathAllowed,
  isFilePathAllowed,
  isWindowsAbsolutePath,
} from "@/lib/file-access";
import { isApiRequestAllowed } from "@/lib/request-security";
import fs from "fs";

// GET /api/comment-entries?cwd=/abs/path
// Returns the comment entries of every .ts/.tsx file under cwd, sorted by path
// and line, plus how many banner/heading comments were excluded. Extraction
// itself is a pure function; this route checks access, then lets
// lib/comment-sources pick the files (git-tracked in a repo, directory walk
// otherwise).
export const GET = withRequestLog("/api/comment-entries", getRouteHandler);

async function getRouteHandler(req: NextRequest) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const cwd = req.nextUrl.searchParams.get("cwd")?.trim() ?? "";
  if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
    return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
  }

  const allowedRoots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, allowedRoots)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(cwd);
  } catch {
    return NextResponse.json({ error: "Directory not found" }, { status: 404 });
  }
  if (!stat.isDirectory()) {
    return NextResponse.json({ error: "Not a directory" }, { status: 400 });
  }
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  return NextResponse.json(extractCommentEntries(await readCommentSourceFiles(cwd)));
}
