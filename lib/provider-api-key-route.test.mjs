import assert from "node:assert/strict";
import test from "node:test";
import { readSource } from "../test-support/source-text";

test("API key saves go through omp's AuthStorage, not a network catalog refresh", async () => {
  const source = await readSource(
    new URL("../app/api/auth/api-key/[provider]/route.ts", import.meta.url),
  );

  // omp keeps credentials in `agent.db`; writing through AuthStorage shares the
  // CLI's store and lock, and avoids the unbounded catalog refresh a login()
  // call would trigger.
  assert.doesNotMatch(source, /\.login\(/);
  assert.match(source, /authStorage\.credentials\.set\(provider, \{ type: "api_key"/);
  assert.match(source, /authStorage\.credentials\.remove\(provider\)/);
});

test("the API key status endpoint never returns the stored key", async () => {
  const source = await readSource(
    new URL("../app/api/auth/api-key/[provider]/route.ts", import.meta.url),
  );
  const getStart = source.indexOf(
    'export const GET = withRequestLog("/api/auth/api-key/[provider]"',
  );
  const getSource = source.slice(getStart, source.indexOf(" export ", getStart + 1));

  assert.doesNotMatch(getSource, /getApiKey|peekApiKey|credential\.key/);
  assert.match(getSource, /configured: authStorage\.keys\.source\(provider\) !== undefined/);
});
