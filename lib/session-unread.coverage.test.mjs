import assert from "node:assert/strict";
import test from "node:test";

import {
  addUnreadSessionIds,
  clearUnreadSessionIds,
  getServerUnreadSessionIds,
  getUnreadSessionIds,
  retainUnreadSessionIds,
  subscribeUnreadSessionIds,
} from "./session-unread.ts";

const STORAGE_KEY = "ompdesk:unread-session-ids";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("hydration, persistence and pruning share one module instance", () => {
  const storage = createStorage({ [STORAGE_KEY]: JSON.stringify(["stored-a", "stored-b"]) });
  const notifications = [];
  globalThis.window = { localStorage: storage };

  try {
    assert.equal(getUnreadSessionIds().size, 0, "snapshot must stay pure before subscription");

    const unsubscribe = subscribeUnreadSessionIds(() => notifications.push([...getUnreadSessionIds()]));
    assert.deepEqual([...getUnreadSessionIds()].sort(), ["stored-a", "stored-b"]);

    addUnreadSessionIds(["stored-a", "fresh"]);
    assert.deepEqual(JSON.parse(storage.values.get(STORAGE_KEY)), ["stored-a", "stored-b", "fresh"]);

    clearUnreadSessionIds(["stored-a"]);
    assert.deepEqual(JSON.parse(storage.values.get(STORAGE_KEY)), ["stored-b", "fresh"]);

    retainUnreadSessionIds(new Set(["fresh"]));
    assert.deepEqual(JSON.parse(storage.values.get(STORAGE_KEY)), ["fresh"]);

    clearUnreadSessionIds(["fresh"]);
    assert.equal(storage.values.has(STORAGE_KEY), false);
    assert.equal(getUnreadSessionIds().size, 0);
    assert.equal(getServerUnreadSessionIds().size, 0);
    assert.ok(notifications.length >= 3, "subscribers should hear real changes");

    unsubscribe();
  } finally {
    delete globalThis.window;
  }
});
