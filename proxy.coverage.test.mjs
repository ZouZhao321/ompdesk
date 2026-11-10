import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test, { after, before } from "node:test";

/**
 * 浏览器页面的拒绝响应由 `proxy.ts` 里那段 HTML 模板产出：API 走 JSON，
 * 页面请求走 `unauthorizedPage()`。这里只验证页面分支的输出版本。
 */
const TASK_DIR = path.join(process.cwd(), ".tmp", "proxy-coverage");
const LOG_DIR = path.join(TASK_DIR, "logs");
const MISSING_AUTH_FILE = path.join(TASK_DIR, "missing-auth.json");
const CORRUPT_AUTH_FILE = path.join(TASK_DIR, "corrupt-auth.json");

const previousPassword = process.env.OMPDESK_PASSWORD;
const previousAuthFile = process.env.OMPDESK_AUTH_FILE;

const { proxy } = await import("./proxy.ts");
const { NextRequest } = await import("next/server");
const { configureLogging } = await import("./lib/logging.ts");

function pageRequest(pathname = "/", headers = {}) {
  return new NextRequest(`http://localhost:30141${pathname}`, {
    headers: { host: "localhost:30141", ...headers },
  });
}

function withEnvironment(vars, run) {
  const previous = new Map();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve(run()).finally(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

before(async () => {
  rmSync(TASK_DIR, { recursive: true, force: true });
  mkdirSync(LOG_DIR, { recursive: true });
  await configureLogging({ file: LOG_DIR, stdout: false, env: { NODE_ENV: "production" } });
});

after(() => {
  if (previousPassword === undefined) delete process.env.OMPDESK_PASSWORD;
  else process.env.OMPDESK_PASSWORD = previousPassword;
  if (previousAuthFile === undefined) delete process.env.OMPDESK_AUTH_FILE;
  else process.env.OMPDESK_AUTH_FILE = previousAuthFile;
  rmSync(TASK_DIR, { recursive: true, force: true });
});

test("a locked browser page gets the HTML sign-in notice instead of JSON", async () => {
  await withEnvironment(
    { OMPDESK_PASSWORD: "correct-horse-battery", OMPDESK_AUTH_FILE: MISSING_AUTH_FILE },
    async () => {
      const response = await proxy(pageRequest("/"));

      assert.equal(response.status, 401);
      assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
      assert.equal(response.headers.get("www-authenticate"), 'Basic realm="ompdesk", charset="UTF-8"');
      assert.equal(response.headers.get("x-frame-options"), "DENY");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");

      const html = await response.text();
      assert.match(html, /<title>ompdesk · authentication required<\/title>/);
      assert.match(html, /<h1>Authentication required<\/h1>/);
      assert.match(html, /<code>omp<\/code>/);
      assert.match(html, /href="\/recover"/);
    },
  );
});

test("a browser page keeps the HTML notice when the sent credentials are wrong", async () => {
  await withEnvironment(
    { OMPDESK_PASSWORD: "correct-horse-battery", OMPDESK_AUTH_FILE: MISSING_AUTH_FILE },
    async () => {
      const authorization = `Basic ${Buffer.from("omp:wrong-horse-battery", "utf8").toString("base64")}`;
      const response = await proxy(pageRequest("/", { authorization }));

      assert.equal(response.status, 401);
      assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
      assert.match(await response.text(), /Authentication required/);
    },
  );
});

test("an authenticated browser page continues with correlation headers instead of a refusal", async () => {
  await withEnvironment(
    { OMPDESK_PASSWORD: "correct-horse-battery", OMPDESK_AUTH_FILE: MISSING_AUTH_FILE },
    async () => {
      const authorization = `Basic ${Buffer.from("omp:correct-horse-battery", "utf8").toString("base64")}`;
      const response = await proxy(pageRequest("/", { authorization }));

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-request-x-ompdesk-actor"), "password");
      assert.match(
        response.headers.get("x-middleware-request-x-ompdesk-request-id") ?? "",
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    },
  );
});

test("a browser page explains an unreadable credential file instead of leaking a JSON error", async () => {
  writeFileSync(CORRUPT_AUTH_FILE, "not a credential file\n");

  await withEnvironment({ OMPDESK_PASSWORD: undefined, OMPDESK_AUTH_FILE: CORRUPT_AUTH_FILE }, async () => {
    const response = await proxy(pageRequest("/"));

    assert.equal(response.status, 503);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);

    const body = await response.text();
    assert.match(body, /credential file could not be read/);
    assert.match(body, /ompdesk --reset-password/);
  });
});
