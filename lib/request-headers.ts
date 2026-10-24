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

export type RequestActor = "local" | "password" | "recovery";

/** Narrow an actor value read from a header, ignoring anything this app did not write. */
export function parseRequestActor(value: string | null | undefined): RequestActor | undefined {
  if (value === "local" || value === "password" || value === "recovery") return value;
  return undefined;
}
