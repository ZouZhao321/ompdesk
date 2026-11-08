/**
 * The control channel the launcher uses to ask a running instance what it is
 * doing. It exists because the CLI cannot answer a Basic Auth prompt: the
 * stored credential is a one-way digest, and the password itself is never kept.
 *
 * The token is generated per start, written into the instance record
 * (owner-only) and handed to the server through the environment. A request
 * without it gets a 404, so an outside caller learns nothing about the route.
 *
 * `bin/daemon-control.js` sends the header. It cannot import this module — the
 * launcher runs before Bun is resolved and cannot load TypeScript — so the wire
 * name is written there too and the two spellings have to match.
 */

export const CONTROL_TOKEN_HEADER = "x-ompdesk-control-token";
export const CONTROL_TOKEN_ENV = "OMPDESK_CONTROL_TOKEN";

/**
 * Routes the launcher may reach without the web password.
 *
 * Listed one by one rather than matched by prefix: a route added under the same
 * directory later must opt in here, so it cannot inherit the bypass by
 * accident. `app/api/control/activity/route.ts` re-checks the token as well, so
 * this list and that check are two independent gates on the same rule.
 */
export const CONTROL_ROUTES = new Set(["/api/control/activity"]);

/**
 * Does the presented token equal the one this instance was started with?
 *
 * The loop itself does no early exit — it reads every byte and accumulates the
 * difference — but the length comparison before it returns immediately, so the
 * function as a whole is not constant time. That is fine for this comparison: it
 * is not a password check. The token never leaves this machine, is compared only
 * over loopback, and both sides are fixed-length hex. `lib/web-auth.ts` keeps the
 * constant-time comparison where a real credential is at stake.
 *
 * "Not configured" and "wrong token" both answer false on purpose: the caller
 * turns that into a bare 404, so an unauthenticated request cannot distinguish
 * the two.
 */
export function controlTokensMatch(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < provided.length; index += 1) {
    difference |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}
