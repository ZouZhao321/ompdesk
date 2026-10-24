import { NextResponse } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { withRequestLog } from "@/lib/api-request-log";
import { buildSessionMap, readMapTurn } from "@/lib/session-map";

export const GET = withRequestLog(
  "/api/sessions/[id]/map",
  async (
    req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    if (!isApiRequestAllowed(req)) {
      return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
    }

    const { id } = await params;
    const turn = new URL(req.url).searchParams.get("turn");
    try {
      if (turn) {
        const detail = await readMapTurn(id, turn);
        if (!detail) return NextResponse.json({ error: "Turn not found" }, { status: 404 });
        return NextResponse.json(detail);
      }
      const payload = await buildSessionMap(id);
      if (!payload) return NextResponse.json({ error: "Session not found" }, { status: 404 });
      return NextResponse.json(payload);
    } catch (error) {
      return NextResponse.json({ error: String(error) }, { status: 500 });
    }
  },
);
