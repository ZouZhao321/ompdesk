import { NextResponse, type NextRequest } from "next/server";
import { isApiRequestAllowed, isApiRequestHostAllowed } from "@/lib/request-security";
import { logEvent } from "@/lib/logging";
import {
	ACTOR_HEADER,
	CLIENT_ADDRESS_HEADER,
	REQUEST_ID_HEADER,
	resolveForwardedAddress,
	type RequestActor,
} from "@/lib/request-headers";
import { authorizeWebRequestWithActor } from "@/lib/web-auth";

/**
 * The password-recovery surface, and the only thing that answers without
 * credentials. It cannot hand out access on its own: the recovery code it mints
 * is printed on the server's console, never returned over HTTP.
 */
const RECOVERY_PAGE = "/recover";
const RECOVERY_API = "/api/web-access/recovery";

const SECURITY_HEADERS = {
	"X-Frame-Options": "DENY",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "no-referrer",
	"Content-Security-Policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
};

const AUTHENTICATE_HEADERS = {
	...SECURITY_HEADERS,
	"Cache-Control": "no-store",
	"WWW-Authenticate": 'Basic realm="ompdesk", charset="UTF-8"',
};

function unauthorizedPage(): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ompdesk · authentication required</title>
<style>
  :root { color-scheme: dark light; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #14161a; color: #e6e8ea;
         font: 15px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  main { max-width: 34rem; padding: 2rem; }
  h1 { font-size: 1.1rem; margin: 0 0 1rem; }
  p { margin: 0 0 0.85rem; color: #a8adb4; }
  code { color: #e6e8ea; }
  a { color: #7aa2f7; }
</style>
</head>
<body>
<main>
  <h1>Authentication required</h1>
  <p>ompdesk is locked. Reload the page and sign in with the username <code>omp</code> and your password.</p>
  <p>Forgot it? <a href="${RECOVERY_PAGE}">Recover access</a> — you will need to read a one-time code off the console
     of the machine running ompdesk.</p>
</main>
</body>
</html>
`;
}

/**
 * Forward the correlation headers to the route handler. The client's own values
 * are replaced, so a caller cannot choose the id their request is logged under.
 */
function continueWithRequestHeaders(request: NextRequest, requestId: string, actor: RequestActor): NextResponse {
	const headers = new Headers(request.headers);
	headers.set(REQUEST_ID_HEADER, requestId);
	headers.set(ACTOR_HEADER, actor);
	// Overwrite any client-supplied value so a route can use this as a
	// rate-limit bucket without trusting forwarding headers itself. The value is
	// only as good as the deployment: without `OMPDESK_TRUST_PROXY` the client
	// sets the forwarding headers, so the address is recorded as `local`.
	headers.set(CLIENT_ADDRESS_HEADER, resolveForwardedAddress(request.headers));
	return NextResponse.next({ request: { headers } });
}

export function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl;
	const requestId = globalThis.crypto.randomUUID();
	const securityFields = {
		requestId,
		route: pathname,
		method: request.method,
	};
	const isApiRequest = pathname === "/api" || pathname.startsWith("/api/");
	const isTrustedRequest = isApiRequest ? isApiRequestAllowed(request) : isApiRequestHostAllowed(request);

	if (!isTrustedRequest) {
		// The combined check already rejected the request; asking about the host
		// again only narrows the reason, it never lets a rejected request through.
		const hostDenied = !isApiRequestHostAllowed(request);
		logEvent("warn", "security", hostDenied ? "security.host.denied" : "security.origin.denied", {
			...securityFields,
			reason: hostDenied ? "untrusted-host" : "cross-site-request",
		});
		if (!isApiRequest) {
			return new NextResponse("Untrusted request", { status: 403, headers: SECURITY_HEADERS });
		}
		return NextResponse.json({ error: "Untrusted API request" }, { status: 403, headers: SECURITY_HEADERS });
	}

	// Recovery stays reachable while locked out — that is the whole point of it —
	// but only after the host and cross-site checks above have run.
	if (pathname === RECOVERY_PAGE || pathname === RECOVERY_API) {
		logEvent("info", "security", "security.recovery.access", {
			...securityFields,
			reason: "recovery-surface",
		});
		return continueWithRequestHeaders(request, requestId, "recovery");
	}

	const authorization = authorizeWebRequestWithActor(request.headers.get("authorization"));

	if (authorization.decision === "unavailable") {
		logEvent("warn", "security", "security.auth.unavailable", {
			...securityFields,
			reason: "credential-file-unreadable",
		});
		const message =
			"Password access is enabled but the ompdesk credential file could not be read." +
			" Run `ompdesk --reset-password` on the server to set a new password.";
		return isApiRequest
			? NextResponse.json(
					{ error: message },
					{ status: 503, headers: { ...SECURITY_HEADERS, "Cache-Control": "no-store" } },
				)
			: new NextResponse(message, {
					status: 503,
					headers: { ...SECURITY_HEADERS, "Cache-Control": "no-store" },
				});
	}

	if (authorization.decision === "unauthorized") {
		logEvent("warn", "security", "security.auth.denied", {
			...securityFields,
			reason: request.headers.get("authorization") ? "invalid-credentials" : "missing-credentials",
		});
		return isApiRequest
			? NextResponse.json(
					{ error: "Authentication required", recoveryPath: RECOVERY_PAGE },
					{ status: 401, headers: AUTHENTICATE_HEADERS },
				)
			: new NextResponse(unauthorizedPage(), {
					status: 401,
					headers: { ...AUTHENTICATE_HEADERS, "Content-Type": "text/html; charset=utf-8" },
				});
	}

	return continueWithRequestHeaders(request, requestId, authorization.actor);
}

export const config = { matcher: ["/", "/recover", "/api/:path*"] };
