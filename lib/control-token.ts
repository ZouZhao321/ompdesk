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
export const CONTROL_API_PREFIX = "/api/control/";

/**
 * Does the presented token equal the one this instance was started with?
 *
 * Not constant time, and not claimed to be: the loop exits early on a length
 * mismatch. That is acceptable here because the comparison is not a password
 * check — the token never leaves this machine, is compared only over loopback,
 * and both sides are fixed-length hex. `lib/web-auth.ts` keeps the constant-time
 * comparison where a real credential is at stake.
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
