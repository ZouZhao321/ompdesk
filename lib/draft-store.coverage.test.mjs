import assert from "node:assert/strict";
import test from "node:test";

const { getDraft, restoreDraftSubmission, setDraft } = await import("./draft-store.ts");

const IMAGE = { data: "aGVsbG8=", mimeType: "image/png" };

test("restores a submitted draft into an empty slot", () => {
  const key = `restore-empty-${process.pid}-${Date.now()}`;
  const restored = restoreDraftSubmission(key, "hello", [IMAGE]);

  assert.deepEqual(restored, { value: "hello", images: [IMAGE] });
  assert.deepEqual(getDraft(key), { value: "hello", images: [IMAGE] });
});

test("merges a submitted draft ahead of the text already composed", () => {
  const key = `restore-merge-${process.pid}-${Date.now()}`;
  const second = { data: "d29ybGQ=", mimeType: "image/jpeg" };
  setDraft(key, { value: "current text", images: [second] });

  const restored = restoreDraftSubmission(key, "submitted text", [IMAGE]);

  assert.equal(restored.value, "submitted text\n\ncurrent text");
  assert.deepEqual(restored.images, [IMAGE, second]);
  assert.deepEqual(getDraft(key), restored);
});

test("drops images that are not valid base64 attachments", () => {
  const key = `restore-invalid-${process.pid}-${Date.now()}`;
  const restored = restoreDraftSubmission(key, "text", [{ data: "not base64!", mimeType: "image/png" }]);

  assert.deepEqual(restored, { value: "text", images: [] });
});
