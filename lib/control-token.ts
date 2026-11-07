/**
 * The control channel the launcher uses to ask a running instance what it is
 * doing. It exists because the CLI cannot answer a Basic Auth prompt: the
 * stored credential is a one-way digest, and the password itself is never kept.
 *
 * The token is generated per start, written into the instance record
 * (owner-only) and handed to the server through the environment. A request
 * without it gets a 404, so an outside caller learns nothing about the route.
 */

export const CONTROL_TOKEN_HEADER = "x-ompdesk-control-token";
export const CONTROL_API_PREFIX = "/api/control/";

/**
 * Constant-time comparison without `node:crypto`, because `proxy.ts` runs on the
 * edge runtime where that module does not exist.
 */
export function controlTokensMatch(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < provided.length; index += 1) {
    difference |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}
