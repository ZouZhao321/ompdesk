import { getRunningRpcSessionIds, subscribeRunningSessions } from "@/lib/rpc-manager";
import { withRequestLog } from "@/lib/api-request-log";
import { openSseStream, type SseStreamSession } from "@/lib/sse-lifecycle";

export const dynamic = "force-dynamic";

// GET /api/agent/running/events - SSE stream of the set of currently-running
// session ids. Pushes an update whenever any session starts or stops working,
// so the sidebar never has to poll.
// The request wrapper completes when the response headers return; the stream
// itself logs http.stream.* for as long as the connection stays open.
export const GET = withRequestLog(
  "/api/agent/running/events",
  async (req: Request) => {
    let streamSession: SseStreamSession | undefined;
    const stream = new ReadableStream({
      start(controller) {
        streamSession = openSseStream({
          controller,
          request: req,
          route: "/api/agent/running/events",
          connect: (send, registerCleanup) => {
            // Subscribe BEFORE taking the initial snapshot so no state change can slip
            // through the gap between snapshot and subscription.
            registerCleanup(subscribeRunningSessions((ids) => {
              send({ type: "running", runningSessionIds: ids });
            }));

            // Initial snapshot so the client renders the correct state immediately.
            // (A duplicate frame here is harmless: the client just sets the same set.)
            send({ type: "running", runningSessionIds: getRunningRpcSessionIds() });
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
