import { logEvent, runWithLogContext, type LogLevel } from "@/lib/logging";
import { ACTOR_HEADER, parseRequestActor, REQUEST_ID_HEADER } from "@/lib/request-headers";

export const DEFAULT_SLOW_REQUEST_MS = 1_000;

/**
 * Slow-request threshold in milliseconds. `OMPDESK_SLOW_REQUEST_MS` overrides
 * the default; anything that is not a positive number keeps the default.
 */
export function resolveSlowRequestMs(env: NodeJS.ProcessEnv = process.env): number {
	const raw = env.OMPDESK_SLOW_REQUEST_MS?.trim();
	if (!raw) return DEFAULT_SLOW_REQUEST_MS;
	const parsed = Number(raw);
	// A positive value below 0.5 would round to 0 and mark every request slow.
	return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.round(parsed)) : DEFAULT_SLOW_REQUEST_MS;
}

function completionLevel(status: number): LogLevel {
	if (status >= 500) return "error";
	if (status >= 400) return "warn";
	return "info";
}

type RouteResult = Response | Promise<Response>;

/**
 * Wrap one App Router route handler with request correlation and a single
 * `http.request` completion record.
 *
 * The request id comes from the proxy; a direct call without one gets a fresh
 * id. Handler arguments, the response object, its status, and its headers all
 * pass through untouched. A thrown handler is logged with its stack before the
 * original error is rethrown, so Next still produces its own 500.
 */
export function withRequestLog<RequestType extends Request, Rest extends unknown[]>(
	route: string,
	handler: (request: RequestType, ...rest: Rest) => RouteResult,
): (request: RequestType, ...rest: Rest) => Promise<Response> {
	return async (request, ...rest) => {
		const requestId = request.headers.get(REQUEST_ID_HEADER)?.trim() || globalThis.crypto.randomUUID();
		const actor = parseRequestActor(request.headers.get(ACTOR_HEADER));
		const method = request.method;
		const startedAt = performance.now();
		const slowRequestMs = resolveSlowRequestMs();

		const complete = (status: number, details: Record<string, unknown> = {}) => {
			const durationMs = Math.round(performance.now() - startedAt);
			logEvent(completionLevel(status), "http", "http.request", {
				requestId,
				route,
				method,
				status,
				durationMs,
				slow: durationMs >= slowRequestMs,
				...(actor ? { actor } : {}),
				...details,
			});
		};

		try {
			const response = await runWithLogContext({ requestId, route, method, ...(actor ? { actor } : {}) }, () =>
				handler(request, ...rest),
			);
			complete(response.status);
			return response;
		} catch (error) {
			complete(500, { failed: true, error });
			throw error;
		}
	};
}
