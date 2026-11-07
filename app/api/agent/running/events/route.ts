import { getRpcSessionActivitySnapshot, subscribeRunningSessions } from "@/lib/rpc-manager";
import { withRequestLog } from "@/lib/api-request-log";
import { openSseStream, type SseStreamSession } from "@/lib/sse-lifecycle";

export const dynamic = "force-dynamic";

// GET /api/agent/running/events - SSE stream carrying the same activity snapshot
// as the polling route: running session ids, ids waiting on a user answer, and
// the runtime→session mapping. Pushes an update whenever any session starts,
// stops, or begins/ends waiting on the browser, so the sidebar never has to
// poll.
// The request wrapper completes when the response headers return; the stream
// itself logs http.stream.* for as long as the connection stays open.
export const GET = withRequestLog("/api/agent/running/events", async (req: Request) => {
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
					registerCleanup(
						subscribeRunningSessions((activity) => {
							send({ type: "running", ...activity });
						}),
					);

					// Initial snapshot so the client renders the correct state immediately.
					// (A duplicate frame here is harmless: the client just sets the same set.)
					send({ type: "running", ...getRpcSessionActivitySnapshot() });
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
});
