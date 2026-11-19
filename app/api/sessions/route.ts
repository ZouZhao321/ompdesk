import { NextResponse } from "next/server";
import { withRequestLog } from "@/lib/api-request-log";
import { attachSessionProjectInfo, listAllSessions, mergeSessionLists } from "@/lib/session-reader";
import { getRpcSessionInfos, getRpcSessionActivitySnapshot } from "@/lib/rpc-manager";
import { readArchivedIds } from "@/lib/session-archive";

export const dynamic = "force-dynamic";

export const GET = withRequestLog("/api/sessions", async (req: Request) => {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const showArchived = new URL(req.url).searchParams.get("archived") === "1";
    const [persistedSessions, runtimeSessions] = await Promise.all([
      listAllSessions({ force }),
      attachSessionProjectInfo(getRpcSessionInfos()),
    ]);
    const archived = readArchivedIds();
    const merged = mergeSessionLists(persistedSessions, runtimeSessions);
    const sessions = merged.filter((s) => (showArchived ? archived.has(s.id) : !archived.has(s.id)));
    // 归档区按需请求：主列表只带一个计数，够侧栏决定是否显示入口。
    const archivedCount = merged.filter((s) => archived.has(s.id)).length;
    return NextResponse.json(
      { sessions, archivedCount, ...getRpcSessionActivitySnapshot() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
});
