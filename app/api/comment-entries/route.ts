import { NextRequest, NextResponse } from "next/server";
import { getAgentDir } from "@oh-my-pi/pi-coding-agent";
import { withRequestLog } from "@/lib/api-request-log";
import {
  extractCommentEntries,
  isCommentSourceFile,
  isSkippedCommentSourceDir,
  type CommentSourceFile,
} from "@/lib/comment-entries";
import { readCommentDictionary, translationsForEntries } from "@/lib/comment-dictionary";
import {
  getAllowedFileRoots,
  isExistingFilePathAllowed,
  isFilePathAllowed,
  isWindowsAbsolutePath,
} from "@/lib/file-access";
import { isApiRequestAllowed } from "@/lib/request-security";
import fs from "fs";
import path from "path";

// GET /api/comment-entries?cwd=/abs/path
// Returns the comment entries of every .ts/.tsx file under cwd, sorted by path
// and line, plus how many banner/heading comments were excluded and the saved
// translations for exactly those entries. Extraction itself is a pure function;
// this route only lists files, reads contents, and joins the local dictionary.
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

  const extraction = extractCommentEntries(readSourceFiles(cwd));
  const dictionary = readCommentDictionary(getAgentDir());
  return NextResponse.json({
    ...extraction,
    translations: translationsForEntries(extraction.entries, dictionary),
  });
}

function readSourceFiles(root: string): CommentSourceFile[] {
  const files: CommentSourceFile[] = [];
  const walk = (absoluteDir: string, relativeDir: string) => {
    const dirents = fs.readdirSync(absoluteDir, { withFileTypes: true });
    for (const dirent of dirents) {
      const relativePath = relativeDir ? `${relativeDir}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        if (!isSkippedCommentSourceDir(dirent.name)) {
          walk(path.join(absoluteDir, dirent.name), relativePath);
        }
        continue;
      }
      if (!dirent.isFile() || !isCommentSourceFile(relativePath)) continue;
      files.push({
        path: relativePath,
        content: fs.readFileSync(path.join(absoluteDir, dirent.name), "utf8"),
      });
    }
  };
  walk(root, "");
  return files;
}
