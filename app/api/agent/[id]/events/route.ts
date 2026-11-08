import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { isApiRequestAllowed } from "@/lib/request-security";
import { withRequestLog } from "@/lib/api-request-log";
import { openSseStream, type SseStreamSession } from "@/lib/sse-lifecycle";
import { toClientEvent } from "@/lib/agent-client-events";

export const dynamic = "force-dynamic";

// GET /api/agent/[id]/events - SSE stream of agent events.
// The request wrapper completes when the response headers return; the stream
// itself logs http.stream.* for as long as the connection stays open.
export const GET = withRequestLog(
  "/api/agent/[id]/events",
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    if (!isApiRequestAllowed(req)) {
      return new Response("Untrusted API request", { status: 403 });
    }

    // Fast path: already-running session
    let session = getRpcSession(id);
    if (!session || !session.isAlive()) {
      const filePath = await resolveSessionPath(id);
      if (!filePath) {
        return new Response("Session not found", { status: 404 });
      }
      try {
        ({ session } = await startRpcSession(id, filePath, undefined));
      } catch {
        return new Response("Failed to start agent", { status: 500 });
      }
    }

    let streamSession: SseStreamSession | undefined;
    const stream = new ReadableStream({
      start(controller) {
        streamSession = openSseStream({
          controller,
          request: req,
          route: "/api/agent/[id]/events",
          sessionId: session.sessionId,
          runtimeId: session.runtimeId,
          connect: (send, registerCleanup) => {
            // Send initial connected event
            send({ type: "connected", sessionId: session.sessionId, runtimeId: session.runtimeId });

            registerCleanup(
              session.onEvent((event) => {
                const clientEvent = toClientEvent(event);
                if (clientEvent) send(clientEvent);
              }),
            );
          },
        });
      },
      cancel() {
        streamSession?.cancel();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  },
);
