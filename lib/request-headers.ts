/**
 * Internal headers the proxy sets on every matched request.
 *
 * Kept in a dependency-free module: the proxy bundle imports it, so it must not
 * pull in `node:async_hooks` through the logging module.
 */

/** Correlation id minted per request and forwarded to the route handler. */
export const REQUEST_ID_HEADER = "x-ompdesk-request-id";

/** How the caller was admitted: local access, the password, or recovery. */
export const ACTOR_HEADER = "x-ompdesk-actor";

/**
 * Caller address as the proxy saw it. The proxy overwrites any client-supplied
 * value, so a route can use it as a rate-limit bucket without reading forwarding
 * headers itself.
 */
export const CLIENT_ADDRESS_HEADER = "x-ompdesk-client-address";

export type RequestActor = "local" | "password" | "recovery";

/**
 * Whether forwarding headers come from a reverse proxy this deployment trusts.
 * A directly reachable server (the default `127.0.0.1` and LAN modes) must not
 * treat them as evidence: the caller sets them, so trusting them would let one
 * client rotate its rate-limit bucket on every request.
 */
export function trustsForwardedAddress(env: NodeJS.ProcessEnv = process.env): boolean {
  const requested = env.OMPDESK_TRUST_PROXY?.trim().toLowerCase();
  return requested === "1" || requested === "true" || requested === "yes" || requested === "on";
}

/**
 * Caller address from the forwarding headers, or `local` when this deployment
 * has no trusted proxy in front of it. `x-forwarded-for` is a hop list that
 * each proxy appends to, so the last entry is the one closest to this server;
 * the first entry is whatever the client chose to send.
 */
export function resolveForwardedAddress(
  headers: Headers,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!trustsForwardedAddress(env)) return "local";
  const forwarded = headers.get("x-forwarded-for")?.split(",");
  const last = forwarded?.[forwarded.length - 1]?.trim();
  return (last || headers.get("x-real-ip")?.trim() || "local").slice(0, 64);
}

/** Narrow an actor value read from a header, ignoring anything this app did not write. */
export function parseRequestActor(value: string | null | undefined): RequestActor | undefined {
  if (value === "local" || value === "password" || value === "recovery") return value;
  return undefined;
}
