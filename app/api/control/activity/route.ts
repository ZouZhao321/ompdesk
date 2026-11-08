import { NextResponse } from "next/server";
import { withRequestLog } from "@/lib/api-request-log";
import { groupSessionActivity } from "@/lib/control-activity";
import { CONTROL_TOKEN_HEADER, controlTokensMatch } from "@/lib/control-token";
import { getRpcSessionActivitySnapshot, getRpcSessionInfos } from "@/lib/rpc-manager";
import { readArchivedIds } from "@/lib/session-archive";
import { attachSessionProjectInfo, listAllSessions, mergeSessionLists } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

/**
 * What `ompdesk status` and `ompdesk stop` read: the same session list the
 * sidebar shows, grouped by project, with the live activity snapshot laid over
 * it. Archived sessions are filtered out the same way, so the counts match what
 * the page displays rather than including rows nobody can see.
 */
export const GET = withRequestLog("/api/control/activity", getRouteHandler);

async function getRouteHandler(request: Request) {
  // Defence in depth: proxy.ts already gates this prefix, and the route refuses
  // on its own so a matcher change cannot silently expose it.
  if (!controlTokensMatch(request.headers.get(CONTROL_TOKEN_HEADER), process.env.OMPDESK_CONTROL_TOKEN)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [persisted, runtime] = await Promise.all([
    listAllSessions(),
    attachSessionProjectInfo(getRpcSessionInfos()),
  ]);
  const snapshot = getRpcSessionActivitySnapshot();
  const archived = readArchivedIds();
  const sessions = mergeSessionLists(persisted, runtime).filter((session) => !archived.has(session.id));

  return NextResponse.json(
    groupSessionActivity(sessions, snapshot.runningSessionIds, snapshot.waitingSessionIds),
    { headers: { "Cache-Control": "no-store" } },
  );
}
