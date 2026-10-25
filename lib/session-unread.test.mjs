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
