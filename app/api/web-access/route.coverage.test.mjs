import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test, { after, beforeEach } from "node:test";
import { createJiti } from "jiti";

/**
 * `app/api/web-access/route.ts` 是密码锁的设置面板接口。凭据文件的真实位置由
 * `OMPDESK_AUTH_FILE` 决定，这里指到 `.tmp/` 下的临时文件，绝不写用户主目录。
 */
const TASK_DIR = path.join(process.cwd(), ".tmp", "web-access-coverage");
const AUTH_FILE = path.join(TASK_DIR, "auth.json");

const previousAuthFile = process.env.OMPDESK_AUTH_FILE;
const previousPassword = process.env.OMPDESK_PASSWORD;
delete process.env.OMPDESK_PASSWORD;
process.env.OMPDESK_AUTH_FILE = AUTH_FILE;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, PUT } = await jiti.import("./route.ts");

const HEADERS = { host: "localhost:30141" };

function putRequest(body, { contentType = "application/json" } = {}) {
  const headers = { ...HEADERS };
  if (contentType !== undefined) headers["content-type"] = contentType;
  return PUT(
    new Request("http://localhost:30141/api/web-access", {
      method: "PUT",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  );
}

beforeEach(() => {
  delete process.env.OMPDESK_PASSWORD;
  process.env.OMPDESK_AUTH_FILE = AUTH_FILE;
  rmSync(TASK_DIR, { recursive: true, force: true });
  mkdirSync(TASK_DIR, { recursive: true });
});

after(() => {
  if (previousAuthFile === undefined) delete process.env.OMPDESK_AUTH_FILE;
  else process.env.OMPDESK_AUTH_FILE = previousAuthFile;
  if (previousPassword === undefined) delete process.env.OMPDESK_PASSWORD;
  else process.env.OMPDESK_PASSWORD = previousPassword;
  rmSync(TASK_DIR, { recursive: true, force: true });
});

test("GET reports an unlocked store without caching the answer", async () => {
  const response = await GET(new Request("http://localhost:30141/api/web-access", { headers: HEADERS }), {
    params: Promise.resolve({}),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    enabled: false,
    configured: false,
    stored: false,
    source: "none",
    managedByEnvironment: false,
    unreadable: false,
    username: "omp",
    updatedAt: null,
    file: AUTH_FILE,
  });
});

test("PUT requires a JSON content type", async () => {
  const response = await putRequest({ action: "enable" }, { contentType: "text/plain" });
  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), { error: "Expected a JSON body" });
});

test("PUT rejects an unparsable body", async () => {
  const response = await putRequest("{action:");
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Expected a JSON body" });
});

test("PUT only knows the documented actions", async () => {
  for (const action of ["rotate", 42, undefined]) {
    const response = await putRequest(action === undefined ? {} : { action });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Unknown action" });
  }
});

test("PUT refuses to edit a password managed by the environment", async () => {
  process.env.OMPDESK_PASSWORD = "managed-by-operator";

  const response = await putRequest({ action: "enable" });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.match(body.error, /OMPDESK_PASSWORD/);
  assert.equal(existsSync(AUTH_FILE), false);
});

test("PUT rejects a password that cannot protect anything", async () => {
  const response = await putRequest({ action: "set-password", password: "short" });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "The password must be at least 8 characters long." });
  assert.equal(existsSync(AUTH_FILE), false);
});

test("set-password stores a usable digest and turns the lock on", async () => {
  const response = await putRequest({ action: "set-password", password: "correct horse" });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const status = await response.json();
  assert.equal(status.enabled, true);
  assert.equal(status.configured, true);
  assert.equal(status.stored, true);
  assert.equal(status.source, "stored");
  assert.equal(typeof status.updatedAt, "string");
  assert.doesNotMatch(readFileSync(AUTH_FILE, "utf8"), /correct horse/);
});

test("enable and disable flip the stored flag without touching the digest", async () => {
  assert.equal((await putRequest({ action: "set-password", password: "correct horse" })).status, 200);

  const disabled = await (await putRequest({ action: "disable" })).json();
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.stored, true);

  const enabled = await (await putRequest({ action: "enable" })).json();
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.stored, true);
});

test("clear removes the stored credential", async () => {
  assert.equal((await putRequest({ action: "set-password", password: "correct horse" })).status, 200);

  const response = await putRequest({ action: "clear" });
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.enabled, false);
  assert.equal(status.configured, false);
  assert.equal(status.source, "none");
});

test("PUT reports the store's own failure when the credential file cannot be written", async () => {
  const blockedDir = path.join(TASK_DIR, "blocked");
  writeFileSync(blockedDir, "not a directory");
  process.env.OMPDESK_AUTH_FILE = path.join(blockedDir, "auth.json");

  const response = await putRequest({ action: "set-password", password: "correct horse" });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(typeof body.error, "string");
  assert.notEqual(body.error, "");
});
