/**
 * 会话列表读取的并发合并：主列表与归档列表各自只有一个进行中的请求，
 * 页面上并发的读取（多个组件、轮询与刷新）不会在服务端放大成多次扫描。
 *
 * 计数按请求的 URL 统计，用例只观察外部可见的请求次数，不碰模块内部的变量。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { fetchArchivedSessions, fetchSessionList } = await jiti.import("./session-list-client.ts");

const LIST_URL = "/api/sessions";
const FORCE_URL = "/api/sessions?force=1";
const ARCHIVED_URL = "/api/sessions?archived=1";

/** 按 URL 应答的 fetch 替身，顺带记录每个 URL 被请求了几次。 */
function stubFetch(handlers) {
  const original = globalThis.fetch;
  const counts = new Map();
  globalThis.fetch = async (input) => {
    const url = String(input);
    counts.set(url, (counts.get(url) ?? 0) + 1);
    const handler = handlers[url];
    if (!handler) throw new Error(`未预期的请求：${url}`);
    return new Response(JSON.stringify(await handler()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return {
    count: (url) => counts.get(url) ?? 0,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** 让应答晚一拍到达，确保调用方看到的是真正进行中的请求。 */
function settleLater(payload) {
  return new Promise((resolve) => setTimeout(() => resolve(payload), 20));
}

function listPayload(sessions) {
  return { sessions, archivedCount: 0, runningSessionIds: [], waitingSessionIds: [], sessionIdsByRuntimeId: {} };
}

test("并发的非 force 列表读取共用一个请求", async (t) => {
  const stub = stubFetch({
    [LIST_URL]: () => settleLater(listPayload([{ id: "session-a" }])),
  });
  t.after(stub.restore);

  const first = fetchSessionList();
  const second = fetchSessionList();
  const third = fetchSessionList();
  assert.equal(first, second, "并发调用必须拿到同一个 Promise");
  assert.equal(second, third, "并发调用必须拿到同一个 Promise");

  const [a, b, c] = await Promise.all([first, second, third]);
  assert.equal(stub.count(LIST_URL), 1, "三个并发读取只能落到一个请求");
  assert.equal(a, b, "并发调用共享同一份结果");
  assert.equal(b, c, "并发调用共享同一份结果");
  assert.equal(a.sessions.length, 1);
  assert.equal(stub.count(FORCE_URL), 0, "非 force 读取不得绕过缓存");
});

test("请求落定后下一次读取重新发起，不返回上一次的结果", async (t) => {
  let round = 0;
  const stub = stubFetch({
    [LIST_URL]: () => settleLater(listPayload([{ id: `session-${(round += 1)}` }])),
  });
  t.after(stub.restore);

  const first = await fetchSessionList();
  const second = await fetchSessionList();
  assert.equal(stub.count(LIST_URL), 2, "落定之后再读必须重新请求");
  assert.notEqual(first.sessions[0].id, second.sessions[0].id, "第二次读取拿到的是新结果");
});

test("force 读取单独发请求，不并入正在进行的非 force 请求", async (t) => {
  const stub = stubFetch({
    [LIST_URL]: () => settleLater(listPayload([{ id: "cached" }])),
    [FORCE_URL]: () => settleLater(listPayload([{ id: "forced" }])),
  });
  t.after(stub.restore);

  const plain = fetchSessionList();
  const forced = fetchSessionList(true);
  const [plainData, forcedData] = await Promise.all([plain, forced]);

  assert.equal(stub.count(LIST_URL), 1, "非 force 读取仍只发一次");
  assert.equal(stub.count(FORCE_URL), 1, "一次 force 读取只发一次绕过缓存的请求");
  assert.equal(plainData.sessions[0].id, "cached", "非 force 读取走普通列表");
  assert.equal(forcedData.sessions[0].id, "forced", "force 读取拿到服务端的新结果");
});

test("并发的归档读取共用一个请求，落定后再读重新发起", async (t) => {
  const stub = stubFetch({
    [ARCHIVED_URL]: () => settleLater({ sessions: [{ id: "archived-a" }] }),
  });
  t.after(stub.restore);

  const first = fetchArchivedSessions();
  const second = fetchArchivedSessions();
  assert.equal(first, second, "并发调用必须拿到同一个 Promise");

  const [a] = await Promise.all([first, second]);
  assert.equal(stub.count(ARCHIVED_URL), 1, "并发的归档读取只能落到一个请求");
  assert.deepEqual(a, [{ id: "archived-a" }], "归档读取返回会话数组");

  await fetchArchivedSessions();
  assert.equal(stub.count(ARCHIVED_URL), 2, "归档区重新展开时必须重新请求");
});
