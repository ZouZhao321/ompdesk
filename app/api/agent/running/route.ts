import { NextResponse } from "next/server";
import { withRequestLog } from "@/lib/api-request-log";
import { getRpcSessionActivitySnapshot } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// GET /api/agent/running - Lightweight snapshot for visible-tab polling.
export const GET = withRequestLog("/api/agent/running", getRouteHandler);

async function getRouteHandler() {
  return NextResponse.json(getRpcSessionActivitySnapshot(), { headers: { "Cache-Control": "no-store" } });
}
