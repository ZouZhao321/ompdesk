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
