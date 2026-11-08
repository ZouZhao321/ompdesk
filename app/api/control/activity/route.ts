import { NextResponse } from "next/server";
import { withRequestLog } from "@/lib/api-request-log";
import { groupSessionActivity } from "@/lib/control-activity";
import { CONTROL_TOKEN_HEADER, controlTokensMatch } from "@/lib/control-token";
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
  // on its own so a matcher change cannot silently expose it. The headers match
  // the proxy's refusal so a misconfiguration degrades to the same response.
  if (!controlTokensMatch(request.headers.get(CONTROL_TOKEN_HEADER), process.env.OMPDESK_CONTROL_TOKEN)) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
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
    return NextResponse.json(
      { error: String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
