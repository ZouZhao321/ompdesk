import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  MAX_COMMENT_TRANSLATION_ENTRIES,
  chunkCommentTranslationEntries,
  commentTranslationErrorKey,
} = await jiti.import("./comment-translation-request.ts");

test("chunks a page-sized selection by the shared request limit", () => {
  const entries = Array.from({ length: 1_484 }, (_, index) => index);
  const batches = chunkCommentTranslationEntries(entries);

  assert.equal(MAX_COMMENT_TRANSLATION_ENTRIES, 1_000);
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [1_000, 484],
  );
  assert.deepEqual(batches.flat(), entries);
});

test("an empty selection produces no requests", () => {
  assert.deepEqual(chunkCommentTranslationEntries([]), []);
});

test("maps server failure codes to specific messages", () => {
  assert.equal(commentTranslationErrorKey("no_model"), "comments.noModel");
  assert.equal(commentTranslationErrorKey("model_unavailable"), "comments.noModel");
  assert.equal(commentTranslationErrorKey("invalid_entries"), "comments.invalidEntries");
  assert.equal(commentTranslationErrorKey("model_failed"), "comments.generateFailed");
  assert.equal(commentTranslationErrorKey("untrusted_request"), "comments.generateFailed");
  assert.equal(commentTranslationErrorKey(undefined), "comments.generateFailed");
});
