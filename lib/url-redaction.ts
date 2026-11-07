/**
 * URL sanitization for free text that ends up in a log or audit record.
 *
 * Shared by the server audit trail (`lib/audit-log.ts`) and the browser error
 * reporter (`lib/client-error-report.ts`), so this module must stay free of
 * Node.js imports. Absolute, protocol-relative, userinfo, and bare-host URLs
 * are all reduced to `host + path` with query values and fragments removed:
 * credentials embedded in a URL must never be persisted.
 */

const REDACTED = "redacted";
/** Base used to parse a protocol-relative URL without inventing a scheme. */
const URL_BASE = "http://ompdesk.invalid";
const PROTOCOL_PREFIX = /^[a-z][a-z0-9+.-]*:/i;
const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:\/\//i;
/**
 * Schemes with no authority, where `@` belongs to the address instead of being
 * userinfo. Without this list a scheme-less `user:pass@host/path` would look
 * like an opaque scheme called `user`.
 */
const OPAQUE_SCHEME = /^(?:mailto|tel|sms|urn|data|callto|magnet):/i;
const AUTHORITY_BREAK = /[/?#]/;

/**
 * Four URL shapes, in precedence order:
 * 1. `scheme://authority...` — the ordinary absolute form.
 * 2. `//authority...` — protocol-relative; no scheme to anchor on.
 * 3. `user:password@host...` — a scheme-less URL that carries credentials.
 * 4. `host.tld/path?query` — a scheme-less URL with a query to strip. The
 *    dotted host and leading `/` keep ordinary paths such as `/api/logs?x=1`
 *    out of the match.
 */
const URL_PATTERN =
	/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+|\/\/[^\s"'<>/]+(?:[/?#][^\s"'<>]*)?|[A-Za-z0-9._%+-]+:[^\s"'<>/@]+@[^\s"'<>]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?\/[^\s"'<>]*\?[^\s"'<>]*/gi;

/** Keep query keys but drop every value, matching what `URL` serialization would produce. */
function redactQueryValues(query: string): string {
	return query
		.split("&")
		.map((pair) => {
			const equals = pair.indexOf("=");
			return equals === -1 ? pair : `${pair.slice(0, equals)}=${REDACTED}`;
		})
		.join("&");
}

/**
 * Text-level redaction for URLs `URL` cannot parse (bad port, unknown scheme,
 * or no scheme at all). The authority is whatever follows the scheme or `//`,
 * up to the first `/`, `?`, or `#`; userinfo is everything before the last `@`.
 */
function redactLooseUrl(raw: string): string {
	const fragmentIndex = raw.indexOf("#");
	const withoutFragment = fragmentIndex === -1 ? raw : raw.slice(0, fragmentIndex);
	const queryIndex = withoutFragment.indexOf("?");
	const beforeQuery = queryIndex === -1 ? withoutFragment : withoutFragment.slice(0, queryIndex);
	const query = queryIndex === -1 ? null : withoutFragment.slice(queryIndex + 1);

	if (OPAQUE_SCHEME.test(beforeQuery)) {
		// `mailto:`, `tel:` and `urn:` have no authority, so an `@` here is part
		// of the address rather than userinfo. Keep the opaque value and only
		// redact the query values.
		return query === null ? beforeQuery : `${beforeQuery}?${redactQueryValues(query)}`;
	}

	const scheme = SCHEME_PREFIX.exec(beforeQuery);
	const authorityStart = scheme ? scheme[0].length : beforeQuery.startsWith("//") ? 2 : 0;
	const prefix = beforeQuery.slice(0, authorityStart);
	const rest = beforeQuery.slice(authorityStart);
	const breakIndex = rest.search(AUTHORITY_BREAK);
	const authority = breakIndex === -1 ? rest : rest.slice(0, breakIndex);
	const tail = breakIndex === -1 ? "" : rest.slice(breakIndex);
	const at = authority.lastIndexOf("@");
	const head = `${prefix}${at === -1 ? authority : authority.slice(at + 1)}${tail}`;

	return query === null ? head : `${head}?${redactQueryValues(query)}`;
}

/** Strip userinfo, query values, and fragments from one URL of any supported form. */
function redactUrl(raw: string): string {
	const protocolRelative = raw.startsWith("//");
	if (!protocolRelative && !SCHEME_PREFIX.test(raw)) return redactLooseUrl(raw);
	try {
		const url = new URL(raw, protocolRelative ? URL_BASE : undefined);
		url.username = "";
		url.password = "";
		url.hash = "";
		// Rebuild the query instead of `set`-ing each key: `set` collapses a
		// repeated parameter (`?a=1&a=2`) into one, which loses the recorded URL's
		// shape. This keeps every key and its order, with only values redacted.
		url.search = new URLSearchParams([...url.searchParams].map(([key]) => [key, REDACTED])).toString();
		const rendered = url.toString();
		return protocolRelative ? rendered.replace(PROTOCOL_PREFIX, "") : rendered;
	} catch {
		return redactLooseUrl(raw);
	}
}

/** Redact every URL embedded in free text (targets, detail strings, error messages). */
export function redactUrlsIn(value: string): string {
	return value.replace(URL_PATTERN, (match) => redactUrl(match));
}
