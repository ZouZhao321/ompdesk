import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  commentDictionaryFilePath,
  deleteCommentDictionary,
  readCommentDictionary,
  saveCommentTranslation,
  translationsForEntries,
} = await jiti.import("./comment-dictionary.ts");
const { commentEntryKey, translationTargetLanguage } = await jiti.import("./comment-entries.ts");

function createAgentDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "ompdesk-comment-dictionary-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function manual(original, targetLanguage, translation, extra = {}) {
  return {
    original,
    originalLanguage: targetLanguage === "en" ? "zh" : "en",
    targetLanguage,
    translation,
    origin: "manual",
    ...extra,
  };
}

test("normalized variants of the same comment share one record", (t) => {
  const agentDir = createAgentDir(t);

  saveCommentTranslation(agentDir, manual("  解析配置\n  并返回结果 ", "en", "Parse the config and return it"));
  saveCommentTranslation(agentDir, manual("解析配置 并返回结果", "en", "Parse the config, then return it"));

  const dictionary = readCommentDictionary(agentDir);
  assert.equal(Object.keys(dictionary.translations).length, 1);
  const key = commentEntryKey("解析配置 并返回结果", "en");
  assert.equal(dictionary.translations[key].translation, "Parse the config, then return it");
  assert.equal(dictionary.translations[key].original, "解析配置 并返回结果");
});

test("a manual translation is stored with its source marker and read back from disk", (t) => {
  const agentDir = createAgentDir(t);

  const saved = saveCommentTranslation(
    agentDir,
    manual("只读的说明", "en", "A read-only description", {
      now: new Date("2026-11-02T03:04:05.000Z"),
    }),
  );

  assert.equal(saved.key, commentEntryKey("只读的说明", "en"));
  assert.equal(saved.original, "只读的说明");
  assert.equal(saved.originalLanguage, "zh");
  assert.equal(saved.targetLanguage, "en");
  assert.equal(saved.translation, "A read-only description");
  assert.equal(saved.origin, "manual");
  assert.equal(saved.model, null);
  assert.equal(saved.updatedAt, "2026-11-02T03:04:05.000Z");

  const reopened = readCommentDictionary(agentDir);
  assert.deepEqual(reopened.translations[saved.key], saved);
  const stored = JSON.parse(readFileSync(commentDictionaryFilePath(agentDir), "utf8"));
  assert.equal(stored.version, 1);
  assert.deepEqual(stored.translations[saved.key], saved);
});

test("the same text in another target language is a separate record", (t) => {
  const agentDir = createAgentDir(t);

  saveCommentTranslation(agentDir, manual("Shared note", "zh", "共用说明"));
  saveCommentTranslation(agentDir, manual("Shared note", "en", "Shared note"));

  const dictionary = readCommentDictionary(agentDir);
  assert.deepEqual(Object.keys(dictionary.translations).sort(), [
    commentEntryKey("Shared note", "en"),
    commentEntryKey("Shared note", "zh"),
  ]);
});

test("deleting the dictionary clears every saved translation", (t) => {
  const agentDir = createAgentDir(t);
  saveCommentTranslation(agentDir, manual("要删除的说明", "en", "A note to delete"));

  assert.equal(deleteCommentDictionary(agentDir), true);
  assert.deepEqual(readCommentDictionary(agentDir), { version: 1, translations: {} });
  assert.equal(existsSync(commentDictionaryFilePath(agentDir)), false);
  assert.equal(deleteCommentDictionary(agentDir), false);
});

test("only translations for the current project's entries are returned", () => {
  const entry = {
    filePath: "src/a.ts",
    startLine: 1,
    endLine: 1,
    text: "当前项目的说明",
    language: "zh",
  };
  const dictionary = {
    version: 1,
    translations: {
      [commentEntryKey("当前项目的说明", "en")]: { key: commentEntryKey("当前项目的说明", "en") },
      [commentEntryKey("另一个项目的说明", "en")]: {
        key: commentEntryKey("另一个项目的说明", "en"),
      },
    },
  };

  assert.deepEqual(Object.keys(translationsForEntries([entry], dictionary)), [commentEntryKey("当前项目的说明", "en")]);
});

test("translation targets the other language", () => {
  assert.equal(translationTargetLanguage("zh"), "en");
  assert.equal(translationTargetLanguage("en"), "zh");
});

test("empty translations and same-language targets are rejected", (t) => {
  const agentDir = createAgentDir(t);

  assert.throws(() => saveCommentTranslation(agentDir, manual("说明", "en", "   ")), /translation/i);
  assert.throws(
    () =>
      saveCommentTranslation(agentDir, {
        ...manual("说明", "en", "A note"),
        targetLanguage: "zh",
      }),
    /language/i,
  );
  assert.deepEqual(readCommentDictionary(agentDir), { version: 1, translations: {} });
});
