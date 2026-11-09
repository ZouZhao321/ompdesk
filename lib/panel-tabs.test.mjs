import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { mergeOpenFileTab, panelViewTab } = await jiti.import("./panel-tabs.ts");

function openRequest(overrides = {}) {
  return { filePath: "/abs/out/report.md", label: "report.md", ...overrides };
}

test("appends a file tab for a file that is not open yet", () => {
  const tabs = mergeOpenFileTab([], openRequest({ modeHint: "diff", openSeq: 1 }));
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].kind, "file");
  assert.equal(tabs[0].filePath, "/abs/out/report.md");
  assert.equal(tabs[0].initialDisplayMode, "diff");
  assert.equal(tabs[0].openSeq, 1);
});

test("reuses the same tab id for the same file instead of opening a second tab", () => {
  const first = mergeOpenFileTab([], openRequest({ modeHint: "diff", openSeq: 1 }));
  const second = mergeOpenFileTab(first, openRequest({ modeHint: "diff", openSeq: 2 }));
  assert.equal(second.length, 1);
  assert.equal(second[0].id, "file:/abs/out/report.md");
});

test("a repeat diff request is a new request even when nothing else changes", () => {
  const first = mergeOpenFileTab([], openRequest({ modeHint: "diff", openSeq: 1 }));
  const second = mergeOpenFileTab(first, openRequest({ modeHint: "diff", openSeq: 2 }));
  assert.notEqual(second, first, "list must be rebuilt so the viewer re-applies the diff");
  assert.equal(second[0].openSeq, 2);
  assert.equal(second[0].initialDisplayMode, "diff");
});

test("a hintless open of an already diff-opened tab returns the list untouched", () => {
  // 回归：openSeq 在无提示打开时恒为 undefined，不能与标签上存过的编号比较，
  // 否则每次普通打开都重建一次标签对象。
  const opened = mergeOpenFileTab([], openRequest({ modeHint: "diff", openSeq: 7 }));
  const again = mergeOpenFileTab(opened, openRequest());
  assert.equal(again, opened, "unchanged hintless open must not allocate a new list");
});

test("a hintless open still records the source session when it differs", () => {
  const opened = mergeOpenFileTab([], openRequest({ sourceSessionId: "s1" }));
  const again = mergeOpenFileTab(opened, openRequest({ sourceSessionId: "s2" }));
  assert.notEqual(again, opened);
  assert.equal(again[0].sourceSessionId, "s2");
});

test("leaves a non-file tab untouched when a file request reuses nothing", () => {
  const viewTab = panelViewTab("git");
  const tabs = mergeOpenFileTab([viewTab], openRequest({ modeHint: "diff", openSeq: 1 }));
  assert.equal(tabs[0], viewTab, "existing view tab must be preserved by reference");
  assert.equal(tabs.length, 2, "the file tab is appended after the view tab");
});

test("a file request never replaces a view tab that shares its id", () => {
  // 视图标签的 id 与文件标签不同；这里直接构造冲突，确认既有的非文件标签不被改写成文件标签。
  const viewTab = panelViewTab("git");
  const collided = [{ ...viewTab, id: "file:/abs/out/report.md" }];
  const tabs = mergeOpenFileTab(collided, openRequest({ modeHint: "diff", openSeq: 1 }));
  assert.equal(tabs, collided, "a non-file tab with the same id must not be rewritten");
});

test("an explicit null source session clears the stale id", () => {
  // 调用方在「当前没有选中会话」时显式传 null；它必须清空标签上残留的 id，
  // 否则文件请求会带着已删除会话的 id 通过服务端授权检查。
  const opened = mergeOpenFileTab([], openRequest({ sourceSessionId: "S1" }));
  const cleared = mergeOpenFileTab(opened, openRequest({ sourceSessionId: null }));
  assert.notEqual(cleared, opened, "clearing a session must rebuild the list");
  assert.equal(cleared[0].sourceSessionId, null);
});

test("an omitted source session leaves the existing one alone", () => {
  const opened = mergeOpenFileTab([], openRequest({ sourceSessionId: "S1" }));
  const untouched = mergeOpenFileTab(opened, openRequest());
  assert.equal(untouched, opened);
});
