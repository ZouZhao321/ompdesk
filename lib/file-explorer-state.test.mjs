import assert from "node:assert/strict";
import test from "node:test";

import { loadExplorerOpen, saveExplorerOpen } from "./file-explorer-state.ts";

const STORAGE_KEY = "pi-web:file-explorer:open";

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    read(key) {
      return values.get(key);
    },
  };
}

test("defaults to open when nothing is stored", () => {
  assert.equal(loadExplorerOpen(fakeStorage()), true);
});

test("reads the stored collapse preference", () => {
  assert.equal(loadExplorerOpen(fakeStorage({ [STORAGE_KEY]: "false" })), false);
  assert.equal(loadExplorerOpen(fakeStorage({ [STORAGE_KEY]: "true" })), true);
});

test("falls back to open when storage cannot be read", () => {
  assert.equal(loadExplorerOpen(null), true);
  const throwing = {
    getItem() {
      throw new Error("storage blocked");
    },
    setItem() {},
  };
  assert.equal(loadExplorerOpen(throwing), true);
});

test("writes the preference and ignores rejected writes", () => {
  const storage = fakeStorage();
  saveExplorerOpen(false, storage);
  assert.equal(storage.read(STORAGE_KEY), "false");
  saveExplorerOpen(true, storage);
  assert.equal(storage.read(STORAGE_KEY), "true");

  const throwing = {
    getItem() {
      return null;
    },
    setItem() {
      throw new Error("quota exceeded");
    },
  };
  assert.doesNotThrow(() => saveExplorerOpen(false, throwing));
  assert.doesNotThrow(() => saveExplorerOpen(true, null));
});
