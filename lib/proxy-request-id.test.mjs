import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { proxy } = await import("../proxy.ts");
const { NextRequest } = await import("next/server");

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Next carries the request headers a proxy rewrote as middleware response
 * headers, so this is the observable form of `NextResponse.next({ request })`.
 */
function forwarded(response) {
  return {
    requestId: response.headers.get("x-middleware-request-x-ompdesk-request-id"),
    actor: response.headers.get("x-middleware-request-x-ompdesk-actor"),
    clientAddress: response.headers.get("x-middleware-request-x-ompdesk-client-address"),
    overridden: response.headers.get("x-middleware-override-headers"),
  };
}

function makeRequest(pathname, headers = {}) {
  return new NextRequest(`http://localhost:30141${pathname}`, {
    headers: { host: "localhost:30141", ...headers },
  });
}

function basicAuthorization(password) {
  return `Basic ${Buffer.from(`omp:${password}`, "utf8").toString("base64")}`;
}

async function withEnvironment(vars, run) {
  const previous = new Map();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function missingAuthFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-proxy-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "ompdesk-auth.json");
}

test("mints a fresh request id for every matched request and overwrites a client value", async (t) => {
  await withEnvironment({ OMPDESK_PASSWORD: undefined, OMPDESK_AUTH_FILE: missingAuthFile(t) }, () => {
    const first = forwarded(proxy(makeRequest("/api/sessions", {
      "x-ompdesk-request-id": "client-supplied",
    })));
    const second = forwarded(proxy(makeRequest("/api/sessions", {
      "x-ompdesk-request-id": "client-supplied",
    })));

    assert.match(first.requestId, UUID_V4);
    assert.match(second.requestId, UUID_V4);
    assert.notEqual(first.requestId, "client-supplied");
    assert.notEqual(first.requestId, second.requestId);
    assert.match(first.overridden, /x-ompdesk-request-id/);
  });
});

test("marks password-authenticated requests with the password actor", async (t) => {
  await withEnvironment({
    OMPDESK_PASSWORD: "correct-horse-battery",
    OMPDESK_AUTH_FILE: missingAuthFile(t),
  }, () => {
    const authorized = forwarded(proxy(makeRequest("/api/sessions", {
      authorization: basicAuthorization("correct-horse-battery"),
    })));
    assert.match(authorized.requestId, UUID_V4);
    assert.equal(authorized.actor, "password");

    const rejected = proxy(makeRequest("/api/sessions", {
      authorization: basicAuthorization("wrong"),
    }));
    assert.equal(rejected.status, 401);
    assert.equal(forwarded(rejected).actor, null);
  });
});

test("marks requests from an unlocked server with the local actor", async (t) => {
  await withEnvironment({ OMPDESK_PASSWORD: undefined, OMPDESK_AUTH_FILE: missingAuthFile(t) }, () => {
    const result = forwarded(proxy(makeRequest("/api/sessions")));
    assert.match(result.requestId, UUID_V4);
    assert.equal(result.actor, "local");
  });
});

test("marks the recovery surface with the recovery actor", async (t) => {
  await withEnvironment({
    OMPDESK_PASSWORD: "correct-horse-battery",
    OMPDESK_AUTH_FILE: missingAuthFile(t),
  }, () => {
    for (const pathname of ["/recover", "/api/web-access/recovery"]) {
      const result = forwarded(proxy(makeRequest(pathname)));
      assert.match(result.requestId, UUID_V4);
      assert.equal(result.actor, "recovery", pathname);
    }
  });
});

test("still rejects untrusted hosts before forwarding headers", async (t) => {
  await withEnvironment({ OMPDESK_PASSWORD: undefined, OMPDESK_AUTH_FILE: missingAuthFile(t) }, () => {
    const response = proxy(new NextRequest("http://localhost:30141/api/sessions", {
      headers: { host: "attacker.example" },
    }));
    assert.equal(response.status, 403);
    assert.equal(forwarded(response).requestId, null);
    assert.equal(forwarded(response).actor, null);
  });
});

test("does not trust client forwarding headers without an explicit proxy setting", async (t) => {
  await withEnvironment({
    OMPDESK_PASSWORD: undefined,
    OMPDESK_AUTH_FILE: missingAuthFile(t),
    OMPDESK_TRUST_PROXY: undefined,
  }, () => {
    const result = forwarded(proxy(makeRequest("/api/sessions", {
      "x-forwarded-for": "203.0.113.9",
      "x-real-ip": "203.0.113.9",
      "x-ompdesk-client-address": "203.0.113.9",
    })));
    // Every forwarding header here is caller-controlled, including a forged
    // internal one, so the bucket must collapse to the local pseudo-address.
    assert.equal(result.clientAddress, "local");
  });
});

test("uses the last forwarding hop only when a proxy is trusted", async (t) => {
  await withEnvironment({
    OMPDESK_PASSWORD: undefined,
    OMPDESK_AUTH_FILE: missingAuthFile(t),
    OMPDESK_TRUST_PROXY: "1",
  }, () => {
    const forwardedChain = forwarded(proxy(makeRequest("/api/sessions", {
      "x-forwarded-for": "192.0.2.10, 203.0.113.9",
    })));
    // The leftmost value is whatever the client sent; the rightmost one is the
    // hop the proxy appended.
    assert.equal(forwardedChain.clientAddress, "203.0.113.9");

    const realIp = forwarded(proxy(makeRequest("/api/sessions", {
      "x-real-ip": "198.51.100.4",
    })));
    assert.equal(realIp.clientAddress, "198.51.100.4");
  });
});
