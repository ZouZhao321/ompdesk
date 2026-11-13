import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test, { after, beforeEach } from "node:test";
import { createJiti } from "jiti";
import { parse as parseYaml } from "yaml";

/**
 * `app/api/models-config/route.ts` 读写 `~/.omp/agent/models.yml`。
 * 这里把 agent 目录换到仓库内的临时目录，读写都落在 `.tmp/` 下，
 * 不碰用户真实的 omp 配置。
 */
const TASK_DIR = path.join(process.cwd(), ".tmp", "models-config-coverage");
const AGENT_DIR = path.join(TASK_DIR, "agent");

rmSync(TASK_DIR, { recursive: true, force: true });

const { getAgentDir, setAgentDir } = await import("@oh-my-pi/pi-utils");
const originalAgentDir = getAgentDir();
setAgentDir(AGENT_DIR);

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, PUT } = await jiti.import("./route.ts");

const HEADERS = { host: "localhost:30141" };

function getRequest(headers = HEADERS) {
  return GET(new Request("http://localhost:30141/api/models-config", { headers }), { params: Promise.resolve({}) });
}

function putRequest(body, { headers = HEADERS, contentType = "application/json" } = {}) {
  const requestHeaders = { ...headers };
  if (contentType !== undefined) requestHeaders["content-type"] = contentType;
  return PUT(
    new Request("http://localhost:30141/api/models-config", {
      method: "PUT",
      headers: requestHeaders,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  );
}

function writeAgentFile(name, content) {
  mkdirSync(AGENT_DIR, { recursive: true });
  writeFileSync(path.join(AGENT_DIR, name), content);
}

function writtenConfig() {
  return parseYaml(readFileSync(path.join(AGENT_DIR, "models.yml"), "utf8"));
}

beforeEach(() => {
  rmSync(AGENT_DIR, { recursive: true, force: true });
  mkdirSync(AGENT_DIR, { recursive: true });
});

after(() => {
  setAgentDir(originalAgentDir);
  rmSync(TASK_DIR, { recursive: true, force: true });
});

test("GET returns an empty provider map when no models file exists", async () => {
  const response = await getRequest();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { providers: {} });
});

test("GET reads models.yml before the legacy yaml and json candidates", async () => {
  writeAgentFile("models.yml", "providers:\n  canonical:\n    models:\n      - id: yml-model\n");
  writeAgentFile("models.yaml", "providers:\n  shadowed:\n    models:\n      - id: yaml-model\n");
  writeAgentFile("models.json", JSON.stringify({ providers: { json: { models: [{ id: "json-model" }] } } }));

  const body = await (await getRequest()).json();
  assert.deepEqual(body.providers, { canonical: { models: [{ id: "yml-model" }] } });
});

test("GET falls back to models.yaml when models.yml is missing", async () => {
  writeAgentFile("models.yaml", "providers:\n  legacy:\n    models:\n      - id: yaml-model\n");

  const body = await (await getRequest()).json();
  assert.deepEqual(body.providers, { legacy: { models: [{ id: "yaml-model" }] } });
});

test("GET still parses a not-yet-migrated models.json", async () => {
  writeAgentFile("models.json", JSON.stringify({ providers: { legacyJson: { models: [{ id: "json-model" }] } } }));

  const body = await (await getRequest()).json();
  assert.deepEqual(body.providers, { legacyJson: { models: [{ id: "json-model" }] } });
});

test("GET degrades to an empty provider map for unparsable YAML", async () => {
  writeAgentFile("models.yml", "providers: [unclosed\n  - id: broken\n");

  const response = await getRequest();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { providers: {} });
});

test("GET degrades to an empty provider map when the document is not a mapping", async () => {
  writeAgentFile("models.yml", "just-a-scalar\n");

  assert.deepEqual(await (await getRequest()).json(), { providers: {} });
});

test("GET refuses an untrusted host before reading the config", async () => {
  writeAgentFile("models.yml", "providers:\n  secret:\n    models:\n      - id: hidden\n");

  const response = await getRequest({ host: "untrusted.invalid" });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Untrusted API request" });
});

test("PUT refuses an untrusted host", async () => {
  const response = await putRequest({ providers: {} }, { headers: { host: "untrusted.invalid" } });
  assert.equal(response.status, 403);
  assert.equal(existsSync(path.join(AGENT_DIR, "models.yml")), false);
});

test("PUT refuses a non-JSON content type", async () => {
  const response = await putRequest({ providers: {} }, { contentType: "text/plain" });
  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), { error: "Content-Type must be application/json" });
});

test("PUT rejects a body that is not an object", async () => {
  const response = await putRequest([{ providers: {} }]);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "models config must be an object" });
});

test("PUT rejects a non-object providers field", async () => {
  const response = await putRequest({ providers: [] });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "providers must be an object" });
});

test("PUT drops blank model rows while keeping entries the schema must still report", async () => {
  const response = await putRequest({
    providers: {
      good: {
        models: [{ id: "model-a" }, { id: "   " }, { id: "" }, { id: 3 }, "not-an-object", { id: "model-b" }],
      },
      empty: { models: [] },
      scalar: 5,
      withoutModels: { baseUrl: "https://example.test" },
    },
    telemetry: false,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.deepEqual(writtenConfig(), {
    providers: {
      good: { models: [{ id: "model-a" }, { id: 3 }, "not-an-object", { id: "model-b" }] },
      empty: { models: [] },
      scalar: 5,
      withoutModels: { baseUrl: "https://example.test" },
    },
    telemetry: false,
  });
});

test("PUT leaves a config without providers untouched and reports zero providers", async () => {
  const response = await putRequest({ telemetry: true });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.deepEqual(writtenConfig(), { telemetry: true });
});

test("PUT round-trips through GET", async () => {
  const config = { providers: { round: { models: [{ id: "round-trip" }] } } };
  assert.equal((await putRequest(config)).status, 200);

  assert.deepEqual(await (await getRequest()).json(), config);
});

test("PUT returns 500 when the request body is not valid JSON", async () => {
  const response = await putRequest("{not json");
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Unable to save models config" });
});
