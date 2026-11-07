import { NextResponse } from "next/server";
import { withRequestLog } from "@/lib/api-request-log";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { allowFileRoot } from "@/lib/file-access";

// POST /api/default-cwd
// Creates ~/omp-cwd-<YYYYMMDD> if it doesn't exist and returns the path.
export const POST = withRequestLog("/api/default-cwd", async () => {
  try {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const dir = join(homedir(), `omp-cwd-${date}`);
    mkdirSync(dir, { recursive: true });
    allowFileRoot(dir);
    return NextResponse.json({ cwd: dir });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
});
