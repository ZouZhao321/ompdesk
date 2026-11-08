import { NextResponse } from "next/server";
import { withRequestLog } from "@/lib/api-request-log";
import { groupSessionActivity } from "@/lib/control-activity";
import { logEvent } from "@/lib/logging";
import { CONTROL_TOKEN_ENV, CONTROL_TOKEN_HEADER, controlTokensMatch } from "@/lib/control-token";
import { SECURITY_HEADERS } from "@/proxy";
import { getRpcSessionActivitySnapshot, getRpcSessionInfos } from "@/lib/rpc-manager";
import { attachSessionProjectInfo, listAllSessions, mergeSessionLists } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

/**
 * What `ompdesk status` and `ompdesk stop` read.
 *
 * Unlike the sidebar, archived sessions stay in: archiving hides a row, it does
 * not stop the work, so `stop` must still refuse for a session archived
 * mid-turn. Every failure answers with a JSON body so the CLI can distinguish
 * "the server failed" from "nothing answered".
 */
export const GET = withRequestLog("/api/control/activity", getRouteHandler);

async function getRouteHandler(request: Request) {
  // Defence in depth: proxy.ts already gates this prefix, and the route refuses
  // on its own so a matcher change cannot silently expose it. The headers are
  // the proxy's own set, so a misconfiguration degrades to the same response
  // instead of a weaker one.
  if (!controlTokensMatch(request.headers.get(CONTROL_TOKEN_HEADER), process.env[CONTROL_TOKEN_ENV])) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: { ...SECURITY_HEADERS, "Cache-Control": "no-store" } },
    );
  }

  try {
    const [persisted, runtime] = await Promise.all([
      listAllSessions(),
      attachSessionProjectInfo(getRpcSessionInfos()),
    ]);
    const snapshot = getRpcSessionActivitySnapshot();

    return NextResponse.json(
      groupSessionActivity(
        mergeSessionLists(persisted, runtime),
        snapshot.runningSessionIds,
        snapshot.waitingSessionIds,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // The details go to the log, not to the caller: this response travels to a
    // CLI that only prints it, and an exception message can carry absolute
    // paths or module names.
    logEvent("error", "http", "http.control.activity.failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Session state is unavailable" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
