import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject(path) {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import(path);
  } catch {
    return import(path);
  }
}

const { buildModelsListUrl, parseDiscoveredModels } = await loadSubject("./model-discovery.ts");
const { resolveModelDiscoveryAuth } = await loadSubject("./model-discovery-auth.ts");

test("builds protocol-appropriate model list URLs", () => {
  assert.equal(buildModelsListUrl("https://api.example.com/v1/", "openai-completions").toString(), "https://api.example.com/v1/models");
  assert.equal(buildModelsListUrl("https://api.anthropic.com", "anthropic-messages").toString(), "https://api.anthropic.com/v1/models?limit=1000");
  assert.equal(buildModelsListUrl("https://generativelanguage.googleapis.com", "google-generative-ai").toString(), "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000");
  assert.equal(buildModelsListUrl("https://api.example.com/custom/models", "openai-responses").toString(), "https://api.example.com/custom/models");
});

test("parses OpenAI, Anthropic, Google, and string model lists", () => {
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "gpt-5" }, { id: "claude", display_name: "Claude" }] }), [
    { id: "claude", name: "Claude" },
    { id: "gpt-5" },
  ]);
  assert.deepEqual(parseDiscoveredModels({ models: [{ name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro" }] }), [
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  ]);
  assert.deepEqual(parseDiscoveredModels(["zeta", "alpha", "alpha"]), [
    { id: "alpha" },
    { id: "zeta" },
  ]);
});

// omp substitutes a header value that names an environment variable (bare
// name, no `$` prefix) with that variable's value.
// 首次 `getOmpRuntime()` 会初始化 Settings/AuthStorage/ModelRegistry（含在线刷新），
// 冷启动在 Windows 上会超过 Bun 默认的 5 秒单测超时。超时中断会跳过
// `resolveModelDiscoveryAuth` 的 finally，把临时目录留在 tmp 里，所以这里给足预算。
test("resolves environment-backed headers without an API key", { timeout: 30_000 }, async () => {
  process.env.OMPDESK_DISCOVERY_TEST_TOKEN = "resolved-token";
  try {
    const auth = await resolveModelDiscoveryAuth("ompdesk-header-only-test", {
      baseUrl: "https://example.invalid/v1",
      api: "openai-completions",
      headers: { "X-Discovery-Token": "OMPDESK_DISCOVERY_TEST_TOKEN" },
    });
    assert.equal(auth.apiKey, undefined);
    assert.deepEqual(auth.headers, { "X-Discovery-Token": "resolved-token" });
  } finally {
    delete process.env.OMPDESK_DISCOVERY_TEST_TOKEN;
  }
});
