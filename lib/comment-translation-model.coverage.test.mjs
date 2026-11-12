import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test, { after, before, beforeEach } from "node:test";
import { createJiti } from "jiti";
import { getAgentDir, setAgentDir } from "@oh-my-pi/pi-utils/dirs";

const sandboxRoot = join(process.cwd(), ".tmp", "lib-logic-one", "comment-translation-model");
const agentDir = join(sandboxRoot, "agent");
const stubDir = join(sandboxRoot, "stubs");
const subjectPath = join(process.cwd(), "lib", "comment-translation-model.ts");

/** 真实依赖路径：装配运行时不需要真实网络，目录发现失败会回落到内置目录。 */
async function loadSubjectWithRealDependencies() {
  const jiti = createJiti(import.meta.url, {
    alias: { "@": process.cwd() },
    interopDefault: true,
    moduleCache: false,
  });
  return jiti.import(subjectPath);
}

/**
 * 替身依赖路径：omp 运行时在校验凭据之后才会暴露 complete()，没有真实凭据
 * 就走不到文本拼装。这里用 jiti 的模块替身覆盖成功、错误和无模型分支。
 */
const stubs = {
  "omp-runtime.mjs": `
export async function getOmpRuntime() {
  return globalThis.__ctStub.runtime;
}
`,
  "omp-settings.mjs": `
export function getSetting(_settings, key) {
  return globalThis.__ctStub.settings[key];
}
`,
  "model-roles.mjs": `
export function readDefaultModelRole() {
  return globalThis.__ctStub.defaultModel;
}
`,
  "model-scope.mjs": `
export async function resolveVisibleModels() {
  return globalThis.__ctStub.scope;
}
export function selectInitialModelScope() {
  return globalThis.__ctStub.selection;
}
`,
  "pi-ai.mjs": `
export async function completeSimple(model, request, options) {
  const stub = globalThis.__ctStub;
  stub.completeCalls.push({ model, request, options });
  if (stub.failComplete) throw new Error("transport exploded");
  return stub.message;
}
`,
};

async function loadSubjectWithStubs() {
  const jiti = createJiti(import.meta.url, {
    alias: { "@": process.cwd(), "@/lib": stubDir, "@oh-my-pi/pi-ai": join(stubDir, "pi-ai.mjs") },
    interopDefault: true,
    moduleCache: false,
    tryNative: false,
  });
  return jiti.import(subjectPath);
}

function resetStub(overrides = {}) {
  globalThis.__ctStub = {
    runtime: {
      settings: {},
      modelRegistry: {
        async getApiKeyAndHeaders(model) {
          return globalThis.__ctStub.credentials(model);
        },
      },
    },
    settings: { enabledModels: ["anthropic/claude-sonnet-4"] },
    defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4" },
    scope: [],
    selection: { model: { provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4" } },
    credentials: () => ({ ok: true, apiKey: "sk-test", headers: { "x-test": "1" } }),
    completeCalls: [],
    message: { stopReason: "stop", content: [{ type: "text", text: "translated" }] },
    failComplete: false,
    ...overrides,
  };
}

let restoreAgentDir;

before(() => {
  restoreAgentDir = { agentDir: getAgentDir(), env: process.env.PI_CODING_AGENT_DIR };
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(stubDir, { recursive: true });
  for (const [name, source] of Object.entries(stubs)) writeFileSync(join(stubDir, name), source);
  setAgentDir(agentDir);
});

beforeEach(() => {
  resetStub();
});

after(() => {
  setAgentDir(restoreAgentDir.agentDir);
  if (restoreAgentDir.env === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = restoreAgentDir.env;
  delete globalThis.__ctStub;
  delete globalThis.__ompRuntimePromise;
  delete globalThis.__ompSettingsPromise;
  rmSync(stubDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("returns null when the runtime has no usable model credentials", async () => {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("offline test runtime");
  };
  delete globalThis.__ompRuntimePromise;
  delete globalThis.__ompSettingsPromise;

  try {
    const { resolveCommentTranslationModel } = await loadSubjectWithRealDependencies();
    assert.equal(await resolveCommentTranslationModel(), null);
  } finally {
    globalThis.fetch = nativeFetch;
    delete globalThis.__ompRuntimePromise;
    delete globalThis.__ompSettingsPromise;
  }
});

test("returns null when no model can be selected", async () => {
  const { resolveCommentTranslationModel } = await loadSubjectWithStubs();
  resetStub({ selection: { model: undefined } });

  assert.equal(await resolveCommentTranslationModel(), null);
});

test("returns null when the registry cannot produce an api key", async () => {
  const { resolveCommentTranslationModel } = await loadSubjectWithStubs();

  globalThis.__ctStub.credentials = () => ({ ok: false });
  assert.equal(await resolveCommentTranslationModel(), null);

  globalThis.__ctStub.credentials = () => ({ ok: true, apiKey: "" });
  assert.equal(await resolveCommentTranslationModel(), null);

  globalThis.__ctStub.credentials = () => ({ ok: true });
  assert.equal(await resolveCommentTranslationModel(), null);
});

test("wraps the selected model and joins the assistant text blocks", async () => {
  const { resolveCommentTranslationModel } = await loadSubjectWithStubs();
  globalThis.__ctStub.message = {
    stopReason: "stop",
    content: [
      { type: "text", text: "第一段" },
      { type: "image", data: "ignored" },
      { type: "text", text: "第二段" },
    ],
  };

  const model = await resolveCommentTranslationModel();
  assert.ok(model);
  assert.equal(model.id, "anthropic/claude-sonnet-4");

  const result = await model.complete("翻译这段");

  assert.equal(result, "第一段第二段");
  const [call] = globalThis.__ctStub.completeCalls;
  assert.equal(call.model.provider, "anthropic");
  assert.deepEqual(
    call.request.messages.map((message) => [message.role, message.content]),
    [["user", "翻译这段"]],
  );
  assert.equal(typeof call.request.messages[0].timestamp, "number");
  assert.equal(call.options.apiKey, "sk-test");
  assert.deepEqual(call.options.headers, { "x-test": "1" });
  assert.equal(call.options.maxTokens, 4_096);
  assert.equal(call.options.cacheRetention, "none");
  assert.ok(call.options.signal instanceof AbortSignal);
  assert.equal(call.options.signal.aborted, false);
});

test("omits headers when the registry resolved none", async () => {
  const { resolveCommentTranslationModel } = await loadSubjectWithStubs();
  globalThis.__ctStub.credentials = () => ({ ok: true, apiKey: "sk-test" });

  const model = await resolveCommentTranslationModel();
  assert.ok(model);
  await model.complete("hi");

  const [call] = globalThis.__ctStub.completeCalls;
  assert.equal("headers" in call.options, false);
});

test("turns error and aborted stop reasons into thrown errors", async () => {
  const { resolveCommentTranslationModel } = await loadSubjectWithStubs();
  const model = await resolveCommentTranslationModel();
  assert.ok(model);

  globalThis.__ctStub.message = { stopReason: "error", errorMessage: "provider exploded", content: [] };
  await assert.rejects(model.complete("x"), /provider exploded/);

  globalThis.__ctStub.message = { stopReason: "error", content: [] };
  await assert.rejects(model.complete("x"), /Model request failed/);

  globalThis.__ctStub.message = { stopReason: "aborted", content: [] };
  await assert.rejects(model.complete("x"), /Model request failed/);
});

test("propagates transport failures from the model call", async () => {
  const { resolveCommentTranslationModel } = await loadSubjectWithStubs();
  const model = await resolveCommentTranslationModel();
  assert.ok(model);
  globalThis.__ctStub.failComplete = true;

  await assert.rejects(model.complete("x"), /transport exploded/);
});
