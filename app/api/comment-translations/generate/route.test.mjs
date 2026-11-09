import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");
const { createCommentTranslationHandler } = await jiti.import("@/lib/comment-translation-route.ts");
const { readCommentDictionary, saveCommentTranslation } = await jiti.import("@/lib/comment-dictionary.ts");

function request(entries) {
  return new Request("http://localhost:30141/api/comment-translations/generate", {
    method: "POST",
    headers: { host: "localhost:30141", "content-type": "application/json" },
    body: JSON.stringify({ entries }),
  });
}

function fixture(t, model) {
  const root = mkdtempSync(join(tmpdir(), "ompdesk-comment-translations-"));
  const agentDir = join(root, "agent");
  mkdirSync(agentDir);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const handler = createCommentTranslationHandler({
    resolveModel: async () => model,
    agentDir: () => agentDir,
  });
  return { agentDir, handler };
}

function modelReply(translations) {
  return JSON.stringify({ translations });
}

test("generation endpoint is wired to the real route", () => {
  assert.equal(typeof POST, "function");
});

test("only the requested entries are translated and unselected manual edits survive", async (t) => {
  const prompts = [];
  const model = {
    id: "fake/model",
    complete: async (prompt) => {
      prompts.push(prompt);
      return modelReply([
        { id: 1, translation: "Set the timeout to 30000 ms" },
        { id: 2, translation: "Read settings.json before start" },
      ]);
    },
  };
  const { agentDir, handler } = fixture(t, model);

  saveCommentTranslation(agentDir, {
    original: "人工修改过的注释",
    originalLanguage: "zh",
    targetLanguage: "en",
    translation: "Manually edited note",
    origin: "manual",
  });

  const response = await handler(
    request([
      { original: "把超时设为 30000 毫秒", originalLanguage: "zh", targetLanguage: "en" },
      { original: "启动前读取 settings.json", originalLanguage: "zh", targetLanguage: "en" },
    ]),
  );
  assert.equal(response.status, 200);
  const payload = await response.json();

  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].includes("人工修改过的注释"), false);
  assert.deepEqual(
    payload.results.map((result) => result.status),
    ["generated", "generated"],
  );

  const dictionary = readCommentDictionary(agentDir);
  const records = Object.values(dictionary.translations);
  assert.equal(records.length, 3);
  for (const original of ["把超时设为 30000 毫秒", "启动前读取 settings.json"]) {
    const record = records.find((candidate) => candidate.original === original);
    assert.equal(record.origin, "model");
    assert.equal(record.model, "fake/model");
  }
  const manual = records.find((candidate) => candidate.original === "人工修改过的注释");
  assert.equal(manual.origin, "manual");
  assert.equal(manual.translation, "Manually edited note");
});

test("a translation that drops a path is reported as failed and not stored", async (t) => {
  const model = {
    id: "fake/model",
    complete: async () => modelReply([{ id: 1, translation: "Read the configuration first" }]),
  };
  const { agentDir, handler } = fixture(t, model);

  const response = await handler(
    request([{ original: "先读取 app/api/route.ts 里的配置", originalLanguage: "zh", targetLanguage: "en" }]),
  );
  assert.equal(response.status, 200);
  const payload = await response.json();

  assert.equal(payload.results.length, 1);
  assert.equal(payload.results[0].status, "failed");
  assert.equal(payload.results[0].reason, "missing_fragments");
  assert.deepEqual(payload.results[0].missing, [{ kind: "path", value: "app/api/route.ts" }]);
  assert.deepEqual(readCommentDictionary(agentDir).translations, {});
});

test("unparsable model output fails every entry instead of writing empty text", async (t) => {
  const model = { id: "fake/model", complete: async () => "Sorry, I cannot help with that." };
  const { agentDir, handler } = fixture(t, model);

  const response = await handler(request([{ original: "读取配置文件", originalLanguage: "zh", targetLanguage: "en" }]));
  const payload = await response.json();

  assert.equal(payload.results[0].status, "failed");
  assert.equal(payload.results[0].reason, "no_output");
  assert.deepEqual(readCommentDictionary(agentDir).translations, {});
});

test("no available model returns an explicit failure and makes no request", async (t) => {
  const { agentDir, handler } = fixture(t, null);

  const response = await handler(request([{ original: "读取配置", originalLanguage: "zh", targetLanguage: "en" }]));

  assert.equal(response.status, 409);
  const payload = await response.json();
  assert.equal(payload.code, "no_model");
  assert.deepEqual(readCommentDictionary(agentDir).translations, {});
});

test("a repeated original and target language hits the dictionary without calling the model", async (t) => {
  let calls = 0;
  const model = {
    id: "fake/model",
    complete: async () => {
      calls += 1;
      return modelReply([{ id: 1, translation: "Read the config" }]);
    },
  };
  const { agentDir, handler } = fixture(t, model);

  saveCommentTranslation(agentDir, {
    original: "读取配置",
    originalLanguage: "zh",
    targetLanguage: "en",
    translation: "Read the config",
    origin: "model",
    model: "earlier/model",
  });

  const response = await handler(request([{ original: "读取配置", originalLanguage: "zh", targetLanguage: "en" }]));
  const payload = await response.json();

  assert.equal(payload.results[0].status, "cached");
  assert.equal(payload.results[0].translation, "Read the config");
  assert.equal(calls, 0);
  assert.equal(readCommentDictionary(agentDir).translations[payload.results[0].key].model, "earlier/model");
});

test("a page-sized selection is split into several model prompts", async (t) => {
  const prompts = [];
  const model = {
    id: "fake/model",
    complete: async (prompt) => {
      prompts.push(prompt);
      const items = JSON.parse(prompt.slice(prompt.indexOf("Items: ") + "Items: ".length));
      return modelReply(
        items.map((item) => ({
          id: item.id,
          translation: `${item.text.match(/\d+/)[0]} note`,
        })),
      );
    },
  };
  const { agentDir, handler } = fixture(t, model);

  const entries = Array.from({ length: 41 }, (_, index) => ({
    original: `注释 ${index + 1}`,
    originalLanguage: "zh",
    targetLanguage: "en",
  }));
  const response = await handler(request(entries));
  const payload = await response.json();

  assert.equal(prompts.length, 2);
  assert.equal(payload.results.length, 41);
  assert.equal(
    payload.results.every((result) => result.status === "generated"),
    true,
  );
  assert.equal(Object.keys(readCommentDictionary(agentDir).translations).length, 41);
});

test("a forced entry regenerates and overwrites the stored translation", async (t) => {
  let calls = 0;
  const model = {
    id: "fake/model",
    complete: async () => {
      calls += 1;
      return modelReply([{ id: 1, translation: "Regenerated config" }]);
    },
  };
  const { agentDir, handler } = fixture(t, model);

  saveCommentTranslation(agentDir, {
    original: "读取配置",
    originalLanguage: "zh",
    targetLanguage: "en",
    translation: "Old manual config",
    origin: "manual",
  });

  const response = await handler(
    request([{ original: "读取配置", originalLanguage: "zh", targetLanguage: "en", force: true }]),
  );
  const payload = await response.json();

  assert.equal(calls, 1);
  assert.equal(payload.results[0].status, "generated");
  assert.equal(payload.results[0].translation, "Regenerated config");
  const record = readCommentDictionary(agentDir).translations[payload.results[0].key];
  assert.equal(record.translation, "Regenerated config");
  assert.equal(record.origin, "model");
  assert.equal(record.model, "fake/model");
});

test("more entries than the per-request limit is rejected as invalid", async (t) => {
  let calls = 0;
  const model = {
    id: "fake/model",
    complete: async () => {
      calls += 1;
      return modelReply([]);
    },
  };
  const { handler } = fixture(t, model);

  const entries = Array.from({ length: 1_001 }, (_, index) => ({
    original: `注释 ${index + 1}`,
    originalLanguage: "zh",
    targetLanguage: "en",
  }));
  const response = await handler(request(entries));

  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "invalid_entries");
  assert.equal(calls, 0);
});
