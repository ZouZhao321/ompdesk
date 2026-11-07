import { createHash, timingSafeEqual } from "node:crypto";
import { resolveWebAuthPolicy, verifyWebPassword, type WebAuthStoreOptions } from "../bin/web-auth-store.js";

export const OMPDESK_AUTH_USERNAME = "omp";

/**
 * Outcome of checking one request's credentials.
 *
 * `unavailable` is not a failed login: it means the lock is on but its
 * credential cannot be read, so the request is refused rather than waved
 * through. See `resolveWebAuthPolicy` in `bin/web-auth-store.js`.
 */
export type WebAuthDecision = "allow" | "unauthorized" | "unavailable";

function hashSecret(value: string): Buffer {
	return createHash("sha256").update(value, "utf8").digest();
}

function secretsEqual(actual: string, expected: string): boolean {
	return timingSafeEqual(hashSecret(actual), hashSecret(expected));
}

export function isWebPasswordEnabled(password: string | undefined = process.env.OMPDESK_PASSWORD): password is string {
	return typeof password === "string" && password.length > 0;
}

/** Decode a `Basic` header, rejecting anything that is not exactly one canonical encoding. */
export function parseBasicCredentials(authorization: string | null): { username: string; password: string } | null {
	if (!authorization) return null;

	const match = /^Basic\s+(\S+)$/i.exec(authorization);
	if (!match) return null;

	let credentials: string;
	try {
		const decoded = Buffer.from(match[1], "base64");
		if (decoded.toString("base64") !== match[1]) return null;
		credentials = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
	} catch {
		return null;
	}

	const separator = credentials.indexOf(":");
	if (separator === -1) return null;

	return {
		username: credentials.slice(0, separator),
		password: credentials.slice(separator + 1),
	};
}

export function isValidBasicAuthorization(
	authorization: string | null,
	password = process.env.OMPDESK_PASSWORD,
): boolean {
	if (!isWebPasswordEnabled(password)) return false;

	const credentials = parseBasicCredentials(authorization);
	if (!credentials) return false;

	const usernameMatches = secretsEqual(credentials.username, OMPDESK_AUTH_USERNAME);
	const passwordMatches = secretsEqual(credentials.password, password);
	return usernameMatches && passwordMatches;
}

/**
 * Authorize one request against whichever credential is in force — the
 * `OMPDESK_PASSWORD` environment variable, or the hashed credential written by
 * the settings panel and `ompdesk --authenticated`.
 */
export function authorizeWebRequest(authorization: string | null, options: WebAuthStoreOptions = {}): WebAuthDecision {
	return authorizeWebRequestWithActor(authorization, options).decision;
}

export type WebAuthAuthorization =
	| { decision: "allow"; actor: "local" | "password" }
	| { decision: "unauthorized" }
	| { decision: "unavailable" };

/** Same decision as `authorizeWebRequest`, plus the actor an audit record needs. */
export function authorizeWebRequestWithActor(
	authorization: string | null,
	options: WebAuthStoreOptions = {},
): WebAuthAuthorization {
	const policy = resolveWebAuthPolicy(options);
	if (policy.mode === "open") return { decision: "allow", actor: "local" };
	if (policy.mode === "unavailable") return { decision: "unavailable" };

	const credentials = parseBasicCredentials(authorization);
	if (!credentials || !secretsEqual(credentials.username, OMPDESK_AUTH_USERNAME)) {
		return { decision: "unauthorized" };
	}
	return verifyWebPassword(credentials.password, { ...options, policy })
		? { decision: "allow", actor: "password" }
		: { decision: "unauthorized" };
}
