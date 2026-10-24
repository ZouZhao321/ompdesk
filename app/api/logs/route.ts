import { NextResponse } from "next/server";
import { withRequestLog } from "@/lib/api-request-log";
import { LogQueryError, parseLogsQuery, readLogDownload, readLogPage } from "@/lib/log-query";

/**
 * Read-only log access for Settings → Logs.
 *
 * The proxy has already enforced host, origin, and password checks. This route
 * only serves the current process's own log file set; `lib/log-query.ts`
 * rejects every other name before touching the filesystem.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export const GET = withRequestLog("/api/logs", getRouteHandler);

async function getRouteHandler(request: Request) {
  try {
    const url = new URL(request.url);
    const query = parseLogsQuery(url.searchParams);

    if (query.download) {
      if (!query.file) throw new LogQueryError(400, "A log file is required for download");
      const download = readLogDownload(query.file);
      return new NextResponse(new Uint8Array(download.data), {
        headers: {
          ...NO_STORE,
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${download.file.name}"`,
          "Content-Length": String(download.data.length),
        },
      });
    }

    return NextResponse.json(
      readLogPage({
        file: query.file,
        cursor: query.cursor,
        limit: query.limit,
        level: query.level,
        keyword: query.keyword,
      }),
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof LogQueryError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    }
    return NextResponse.json({ error: "Unable to read logs" }, { status: 500, headers: NO_STORE });
  }
}
