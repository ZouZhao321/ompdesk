import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  addUnreadSessionIds,
  clearUnreadSessionIds,
  getServerUnreadSessionIds,
  getUnreadSessionIds,
  retainUnreadSessionIds,
  subscribeUnreadSessionIds,
} = await createJiti(import.meta.url).import("./session-unread.ts");

test("notifies subscribers once per real change", () => {
  let notifications = 0;
  const unsubscribe = subscribeUnreadSessionIds(() => { notifications += 1; });

  addUnreadSessionIds(["a"]);
  assert.deepEqual([...getUnreadSessionIds()], ["a"]);
  assert.equal(notifications, 1);

  addUnreadSessionIds(["a"]);
  assert.equal(notifications, 1, "an already unread id must not notify again");

  clearUnreadSessionIds(["a"]);
  assert.deepEqual([...getUnreadSessionIds()], []);
  assert.equal(notifications, 2);

  unsubscribe();
});

test("clears the marker of a session the user opens", () => {
  addUnreadSessionIds(["opened", "other"]);

  clearUnreadSessionIds(["opened"]);

  assert.deepEqual([...getUnreadSessionIds()], ["other"]);
  clearUnreadSessionIds(["other"]);
});

test("ignores ids that are not unread", () => {
  addUnreadSessionIds(["kept"]);
  let notifications = 0;
  const unsubscribe = subscribeUnreadSessionIds(() => { notifications += 1; });

  clearUnreadSessionIds(["never-added"]);

  assert.deepEqual([...getUnreadSessionIds()], ["kept"]);
  assert.equal(notifications, 0);

  unsubscribe();
  clearUnreadSessionIds(["kept"]);
});

test("retains only the ids of sessions that still exist", () => {
  addUnreadSessionIds(["kept", "deleted"]);

  retainUnreadSessionIds(new Set(["kept"]));

  assert.deepEqual([...getUnreadSessionIds()], ["kept"]);
  clearUnreadSessionIds(["kept"]);
});

test("stopped subscribers stop hearing about changes", () => {
  let notifications = 0;
  const unsubscribe = subscribeUnreadSessionIds(() => { notifications += 1; });
  unsubscribe();

  addUnreadSessionIds(["after-unsubscribe"]);

  assert.equal(notifications, 0);
  clearUnreadSessionIds(["after-unsubscribe"]);
});

test("keeps the server snapshot empty", () => {
  addUnreadSessionIds(["ssr"]);

  assert.equal(getServerUnreadSessionIds().size, 0);

  clearUnreadSessionIds(["ssr"]);
});

const STORAGE_KEY = "ompdesk:unread-session-ids";
let freshInstanceCount = 0;

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

/**
 * 每个用例都拿一份新的模块实例：水合标志缓存在模块级，共享实例会互相污染。
 *
 * jiti 的 `moduleCache: false` 在 `bun test` 下被 Bun 自己的模块缓存盖过，
 * 所以用带查询串的原生 import 让 Bun 重新求值模块。
 */
async function loadUnreadModule(storage) {
  globalThis.window = { localStorage: storage };
  freshInstanceCount += 1;
  return import(`./session-unread.ts?fresh=${freshInstanceCount}`);
}

test("订阅时补齐存储，之前快照保持纯读取", async () => {
  const storage = createStorage({ [STORAGE_KEY]: JSON.stringify(["stored-a", "stored-b"]) });
  try {
    const { getUnreadSessionIds, subscribeUnreadSessionIds } = await loadUnreadModule(storage);

    // 快照在渲染期被调用，不能有副作用：水合之前读到的是空集合。
    assert.equal(getUnreadSessionIds().size, 0, "快照读取不得自行水合");
    const unsubscribe = subscribeUnreadSessionIds(() => {});

    assert.deepEqual([...getUnreadSessionIds()].sort(), ["stored-a", "stored-b"]);
    assert.equal(storage.values.get(STORAGE_KEY), JSON.stringify(["stored-a", "stored-b"]));
    unsubscribe();
  } finally {
    delete globalThis.window;
  }
});

test("writes newly unread ids back to storage", async () => {
  const storage = createStorage({ [STORAGE_KEY]: JSON.stringify(["stored-a"]) });
  try {
    const { addUnreadSessionIds, getUnreadSessionIds } = await loadUnreadModule(storage);

    addUnreadSessionIds(["stored-a", "fresh"]);

    assert.deepEqual([...getUnreadSessionIds()].sort(), ["fresh", "stored-a"]);
    assert.deepEqual(JSON.parse(storage.values.get(STORAGE_KEY)), ["stored-a", "fresh"]);
  } finally {
    delete globalThis.window;
  }
});

test("removes the storage key once every id is cleared", async () => {
  const storage = createStorage({ [STORAGE_KEY]: JSON.stringify(["only"]) });
  try {
    const { clearUnreadSessionIds, getUnreadSessionIds } = await loadUnreadModule(storage);

    clearUnreadSessionIds(["only"]);

    assert.equal(getUnreadSessionIds().size, 0);
    assert.equal(storage.values.has(STORAGE_KEY), false);
  } finally {
    delete globalThis.window;
  }
});

test("ignores an unreadable stored payload", async () => {
  for (const stored of ["{not-json", `{"id":"object-shaped"}`, "42"]) {
    const storage = createStorage({ [STORAGE_KEY]: stored });
    try {
      const { getUnreadSessionIds, subscribeUnreadSessionIds } = await loadUnreadModule(storage);
      const unsubscribe = subscribeUnreadSessionIds(() => {});
      assert.equal(getUnreadSessionIds().size, 0, `stored payload ${stored}`);
      unsubscribe();
    } finally {
      delete globalThis.window;
    }
  }
});

test("drops non-string entries from a stored payload", async () => {
  const storage = createStorage({ [STORAGE_KEY]: JSON.stringify(["kept", 7, null]) });
  try {
    const { getUnreadSessionIds, subscribeUnreadSessionIds } = await loadUnreadModule(storage);

    const unsubscribe = subscribeUnreadSessionIds(() => {});
    assert.deepEqual([...getUnreadSessionIds()], ["kept"]);
    unsubscribe();
  } finally {
    delete globalThis.window;
  }
});
