import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./transcript-view-state.ts");
}

test("falls back to the caller's default until the viewer toggles", async () => {
  const { createTranscriptViewStore, PROCESS_DETAILS_PART } = await loadSubject();
  const store = createTranscriptViewStore();

  assert.equal(store.isExpanded("session-a", "anchor-1", PROCESS_DETAILS_PART, true), true);
  assert.equal(store.isExpanded("session-a", "anchor-1", PROCESS_DETAILS_PART, false), false);
});

test("toggles the requested part and reports the new value", async () => {
  const { createTranscriptViewStore, PROCESS_DETAILS_PART } = await loadSubject();
  const store = createTranscriptViewStore();

  store.toggleExpanded("session-a", "anchor-1", PROCESS_DETAILS_PART, false);
  assert.equal(store.isExpanded("session-a", "anchor-1", PROCESS_DETAILS_PART, false), true);

  store.toggleExpanded("session-a", "anchor-1", PROCESS_DETAILS_PART, false);
  assert.equal(store.isExpanded("session-a", "anchor-1", PROCESS_DETAILS_PART, false), false);
});

test("toggles from the caller's default when nothing is stored yet", async () => {
  const { createTranscriptViewStore, PROCESS_DETAILS_PART } = await loadSubject();
  const store = createTranscriptViewStore();

  // 编辑类工具调用默认展开，第一次点击应当收起。
  store.toggleExpanded("session-a", "anchor-1", PROCESS_DETAILS_PART, true);
  assert.equal(store.isExpanded("session-a", "anchor-1", PROCESS_DETAILS_PART, true), false);
});

test("keeps parts of the same turn independent", async () => {
  const { createTranscriptViewStore, toolCallPart, PROCESS_DETAILS_PART } = await loadSubject();
  const store = createTranscriptViewStore();
  const firstCall = toolCallPart("call-1");
  const secondCall = toolCallPart("call-2");

  store.toggleExpanded("session-a", "anchor-1", firstCall, false);

  assert.equal(store.isExpanded("session-a", "anchor-1", firstCall, false), true);
  assert.equal(store.isExpanded("session-a", "anchor-1", secondCall, false), false);
  assert.equal(store.isExpanded("session-a", "anchor-1", PROCESS_DETAILS_PART, false), false);
});

test("keeps fetched delayed content next to its loaded mark", async () => {
  const { createTranscriptViewStore, thinkingPart } = await loadSubject();
  const store = createTranscriptViewStore();
  const part = thinkingPart("entry-3", 0);

  assert.equal(store.loadedContent("session-a", "anchor-1", part), null);

  store.markLoaded("session-a", "anchor-1", part, "先想一下");
  // 正文与标记一起留着：条目卸载重建的首帧直接渲染它，不必再请求。
  assert.equal(store.loadedContent("session-a", "anchor-1", part), "先想一下");

  // 重复标记同一段正文不再通知订阅方，避免思考块加载完就触发整段转写重渲染。
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });
  store.markLoaded("session-a", "anchor-1", part, "先想一下");
  assert.equal(notifications, 0);
});

test("leaves expand subscribers alone when delayed content lands", async () => {
  const { createTranscriptViewStore, thinkingPart, PROCESS_DETAILS_PART } = await loadSubject();
  const store = createTranscriptViewStore();
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });

  // 正文只给下一次挂载读，不经过展开状态的通知通道。
  store.markLoaded("session-a", "anchor-1", thinkingPart("entry-2", 0), "先想一下");
  assert.equal(notifications, 0);

  // 展开切换仍然通知，展开状态的语义不变。
  store.toggleExpanded("session-a", "anchor-1", PROCESS_DETAILS_PART, false);
  assert.equal(notifications, 1);
});

test("keeps a stored body even when the session id is missing", async () => {
  const { planDeferredContent } = await loadSubject();

  // 正文已经在视图状态里：会话还没落盘也直接渲染，不许换成「取不回来」。
  assert.deepEqual(planDeferredContent("先想一下", undefined, "entry-1"), { kind: "stored", content: "先想一下" });
  assert.deepEqual(planDeferredContent("先想一下", "session-a", "entry-1"), { kind: "stored", content: "先想一下" });
  // 没有正文才轮到会话 id 与 entryId 决定：能请求就去请求，缺一个就报取不回来。
  assert.deepEqual(planDeferredContent(null, "session-a", "entry-1"), {
    kind: "fetch",
    sessionId: "session-a",
    entryId: "entry-1",
  });
  assert.deepEqual(planDeferredContent(null, undefined, "entry-1"), { kind: "unavailable" });
  assert.deepEqual(planDeferredContent(null, "session-a", undefined), { kind: "unavailable" });
});

test("isolates state per session", async () => {
  const { createTranscriptViewStore, thinkingPart, PROCESS_DETAILS_PART } = await loadSubject();
  const store = createTranscriptViewStore();
  const part = thinkingPart("entry-1", 0);

  store.toggleExpanded("session-a", "anchor-1", PROCESS_DETAILS_PART, false);
  store.markLoaded("session-a", "anchor-1", part, "只在会话 a");

  // 同一锚点的 entryId 在两条会话里各有一份互不影响的状态。
  assert.equal(store.isExpanded("session-b", "anchor-1", PROCESS_DETAILS_PART, false), false);
  assert.equal(store.isExpanded("session-b", "anchor-1", PROCESS_DETAILS_PART, true), true);
  assert.equal(store.loadedContent("session-b", "anchor-1", part), null);
});

test("keeps state when the entry is rebuilt after unmounting", async () => {
  const { createTranscriptViewStore, PROCESS_DETAILS_PART } = await loadSubject();
  const store = createTranscriptViewStore();

  const unmount = store.subscribe(() => {});
  store.toggleExpanded("session-a", "anchor-1", PROCESS_DETAILS_PART, false);
  unmount();

  // 虚拟列表卸载条目后再挂回来，读到的仍是用户最后一次的选择。
  const remount = store.subscribe(() => {});
  assert.equal(store.isExpanded("session-a", "anchor-1", PROCESS_DETAILS_PART, false), true);
  remount();
});

test("notifies subscribers on toggle until they unsubscribe", async () => {
  const { createTranscriptViewStore, PROCESS_DETAILS_PART } = await loadSubject();
  const store = createTranscriptViewStore();
  let notifications = 0;

  store.toggleExpanded("session-a", "anchor-1", PROCESS_DETAILS_PART, false);
  assert.equal(notifications, 0);

  const unsubscribe = store.subscribe(() => {
    notifications += 1;
  });
  store.toggleExpanded("session-a", "anchor-1", PROCESS_DETAILS_PART, false);
  assert.equal(notifications, 1);

  unsubscribe();
  store.toggleExpanded("session-a", "anchor-1", PROCESS_DETAILS_PART, false);
  assert.equal(notifications, 1);
});

test("evicts the oldest entries once the store reaches its limit", async () => {
  const { createTranscriptViewStore, MAX_VIEW_ENTRIES, thinkingPart } = await loadSubject();
  const store = createTranscriptViewStore();

  for (let index = 0; index <= MAX_VIEW_ENTRIES; index += 1) {
    store.markLoaded("session-a", "anchor-1", thinkingPart(`entry-${index}`, 0), `正文 ${index}`);
  }

  // 长会话里的思考正文不该无限堆积：最早写入的一条先走，最新的还在。
  assert.equal(store.loadedContent("session-a", "anchor-1", thinkingPart("entry-0", 0)), null);
  assert.equal(
    store.loadedContent("session-a", "anchor-1", thinkingPart(`entry-${MAX_VIEW_ENTRIES}`, 0)),
    `正文 ${MAX_VIEW_ENTRIES}`,
  );
});

test("keeps recently written entries when the store is full", async () => {
  const { createTranscriptViewStore, MAX_VIEW_ENTRIES, thinkingPart } = await loadSubject();
  const store = createTranscriptViewStore();

  for (let index = 0; index < MAX_VIEW_ENTRIES; index += 1) {
    store.markLoaded("session-a", "anchor-1", thinkingPart(`entry-${index}`, 0), `正文 ${index}`);
  }
  // 最早写入的一条后来又被写了一次（正文刷新）：淘汰看写入顺序，它因此排到最后。
  store.markLoaded("session-a", "anchor-1", thinkingPart("entry-0", 0), "正文 0 又写了一次");
  store.markLoaded("session-a", "anchor-1", thinkingPart("entry-new", 0), "新正文");

  assert.equal(store.loadedContent("session-a", "anchor-1", thinkingPart("entry-0", 0)), "正文 0 又写了一次");
  // 真正最久没写的是紧随其后的 entry-1。
  assert.equal(store.loadedContent("session-a", "anchor-1", thinkingPart("entry-1", 0)), null);
});

test("does not refresh the eviction order on reads", async () => {
  const { createTranscriptViewStore, MAX_VIEW_ENTRIES, thinkingPart } = await loadSubject();
  const store = createTranscriptViewStore();

  for (let index = 0; index < MAX_VIEW_ENTRIES; index += 1) {
    store.markLoaded("session-a", "anchor-1", thinkingPart(`entry-${index}`, 0), `正文 ${index}`);
  }
  // 读只取值、不改仓库：最早写入的一条被读过，也仍是下一轮淘汰的那条。
  assert.equal(store.loadedContent("session-a", "anchor-1", thinkingPart("entry-0", 0)), "正文 0");
  store.markLoaded("session-a", "anchor-1", thinkingPart("entry-new", 0), "新正文");

  assert.equal(store.loadedContent("session-a", "anchor-1", thinkingPart("entry-0", 0)), null);
});

test("spares expand state while there is content-only state to drop", async () => {
  const { createTranscriptViewStore, MAX_VIEW_ENTRIES, thinkingPart, PROCESS_DETAILS_PART } = await loadSubject();
  const store = createTranscriptViewStore();

  // 最早的一条带着用户的选择，后面全是正文：淘汰先拿正文开刀。
  store.toggleExpanded("session-a", "anchor-expanded", PROCESS_DETAILS_PART, false);
  for (let index = 0; index < MAX_VIEW_ENTRIES; index += 1) {
    store.markLoaded("session-a", "anchor-1", thinkingPart(`entry-${index}`, 0), `正文 ${index}`);
  }

  assert.equal(store.isExpanded("session-a", "anchor-expanded", PROCESS_DETAILS_PART, false), true);
  assert.equal(store.loadedContent("session-a", "anchor-1", thinkingPart("entry-0", 0)), null);
});

test("notifies subscribers when eviction takes an expand state away", async () => {
  const { createTranscriptViewStore, MAX_VIEW_ENTRIES, thinkingPart, PROCESS_DETAILS_PART } = await loadSubject();
  const store = createTranscriptViewStore();

  for (let index = 0; index < MAX_VIEW_ENTRIES; index += 1) {
    store.toggleExpanded("session-a", `anchor-${index}`, PROCESS_DETAILS_PART, false);
  }

  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });
  // 新条目把最早的一条展开状态挤掉：已挂载的订阅方快照过期，必须补一次通知。
  store.toggleExpanded("session-a", "anchor-new", PROCESS_DETAILS_PART, false);
  assert.equal(notifications, 1);
  assert.equal(store.isExpanded("session-a", "anchor-0", PROCESS_DETAILS_PART, false), false);

  // 只丢正文时不必通知：正文只服务下一次挂载的首帧，渲染期的读数不经过订阅。
  const contentOnlyStore = createTranscriptViewStore();
  let contentOnlyNotifications = 0;
  contentOnlyStore.subscribe(() => {
    contentOnlyNotifications += 1;
  });
  for (let index = 0; index <= MAX_VIEW_ENTRIES; index += 1) {
    contentOnlyStore.markLoaded("session-b", "anchor-1", thinkingPart(`entry-${index}`, 0), `正文 ${index}`);
  }
  assert.equal(contentOnlyNotifications, 0);
});

test("drops the entries of the session the view left", async () => {
  const { createTranscriptViewStore, thinkingPart, PROCESS_DETAILS_PART } = await loadSubject();
  const store = createTranscriptViewStore();
  const part = thinkingPart("entry-1", 0);
  store.markLoaded("session-a", "anchor-1", part, "只属于会话 a");
  store.toggleExpanded("session-a", "anchor-1", PROCESS_DETAILS_PART, false);

  store.retainSession("session-b");

  assert.equal(store.loadedContent("session-a", "anchor-1", part), null);
  assert.equal(store.isExpanded("session-a", "anchor-1", PROCESS_DETAILS_PART, false), false);
});

test("keeps the entries of the session the view stays on", async () => {
  const { createTranscriptViewStore, thinkingPart } = await loadSubject();
  const store = createTranscriptViewStore();
  const part = thinkingPart("entry-1", 0);
  store.markLoaded("session-a", "anchor-1", part, "正文");

  store.retainSession("session-a");

  assert.equal(store.loadedContent("session-a", "anchor-1", part), "正文");
});

test("keeps stored state while the view has no session id yet", async () => {
  const { createTranscriptViewStore, thinkingPart } = await loadSubject();
  const store = createTranscriptViewStore();
  const part = thinkingPart("entry-1", 0);
  store.markLoaded("session-a", "anchor-1", part, "正文");

  // 还没落盘的新会话不知道下一次点击会落到哪一桶，先不动已存的状态。
  store.retainSession(undefined);

  assert.equal(store.loadedContent("session-a", "anchor-1", part), "正文");
});

test("forgets every entry of a deleted session", async () => {
  const { createTranscriptViewStore, thinkingPart } = await loadSubject();
  const store = createTranscriptViewStore();
  const part = thinkingPart("entry-1", 0);
  store.markLoaded("session-a", "anchor-1", part, "会话 a 的正文");
  store.markLoaded("session-b", "anchor-1", part, "会话 b 的正文");

  store.forgetSession("session-a");

  assert.equal(store.loadedContent("session-a", "anchor-1", part), null);
  assert.equal(store.loadedContent("session-b", "anchor-1", part), "会话 b 的正文");
});

test("notifies subscribers only when a cleanup actually drops entries", async () => {
  const { createTranscriptViewStore, thinkingPart } = await loadSubject();
  const store = createTranscriptViewStore();
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });

  // 空仓库切会话，没有条目可丢，不动订阅方。
  store.retainSession("session-a");
  assert.equal(notifications, 0);

  // 写入正文不走展开状态的通知通道，但条目照常记下。
  store.markLoaded("session-a", "anchor-1", thinkingPart("entry-1", 0), "正文");
  assert.equal(notifications, 0);

  // 停在同一个会话上不算切换。
  store.retainSession("session-a");
  assert.equal(notifications, 0);

  store.retainSession("session-b");
  assert.equal(notifications, 1);
});
