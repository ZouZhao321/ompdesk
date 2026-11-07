import { NextResponse } from "next/server";
import { withRequestLog } from "@/lib/api-request-log";
import { homedir } from "os";

export const GET = withRequestLog("/api/home", getRouteHandler);

async function getRouteHandler() {
	return NextResponse.json({ home: homedir() });
}
