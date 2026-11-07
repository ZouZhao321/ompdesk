import { NextResponse } from "next/server";
import { withRequestLog } from "@/lib/api-request-log";
import { groupSessionActivity } from "@/lib/control-activity";
import { CONTROL_TOKEN_HEADER, controlTokensMatch } from "@/lib/control-token";
import { getRpcSessionActivitySnapshot, getRpcSessionInfos } from "@/lib/rpc-manager";
import { attachSessionProjectInfo, listAllSessions, mergeSessionLists } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

/**
 * What `ompdesk status` and `ompdesk stop` read: the same session list the
 * sidebar shows, grouped by project, with the live activity snapshot laid over
 * it. Session counts come from disk so a project keeps its row after its last
 * turn ends; `running` and `waiting` come from the runtime, so `stop` only
 * refuses for work this process can actually interrupt.
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

  return NextResponse.json(
    groupSessionActivity(
      mergeSessionLists(persisted, runtime),
      snapshot.runningSessionIds,
      snapshot.waitingSessionIds,
    ),
    { headers: { "Cache-Control": "no-store" } },
  );
}
