import assert from "node:assert/strict";
import { mock } from "bun:test";
import test from "node:test";

const hookCalls = [];
mock.module("react", () => ({
  useCallback: (callback) => callback,
  useSyncExternalStore: (subscribe, getSnapshot, getServerSnapshot) => {
    hookCalls.push({ subscribe, getSnapshot, getServerSnapshot });
    return getSnapshot();
  },
}));

const { transcriptViewState, useTranscriptExpanded } = await import("./transcript-view-state.ts");
mock.restore();

test("wires the hook to the shared view store through the external-store contract", () => {
  const sessionId = `hook-session-${process.pid}-${Date.now()}`;
  const part = "process";

  assert.equal(useTranscriptExpanded(sessionId, "anchor-1", part, false), false);
  assert.equal(hookCalls.length, 1);
  const { subscribe, getSnapshot, getServerSnapshot } = hookCalls[0];

  assert.equal(getServerSnapshot(), false, "the server snapshot keeps the caller's default");

  let notifications = 0;
  const unsubscribe = subscribe(() => {
    notifications += 1;
  });

  transcriptViewState.toggleExpanded(sessionId, "anchor-1", part, false);
  assert.equal(notifications, 1);
  assert.equal(getSnapshot(), true);

  unsubscribe();
  transcriptViewState.toggleExpanded(sessionId, "anchor-1", part, false);
  assert.equal(notifications, 1, "an unsubscribed listener is not called again");
  assert.equal(getSnapshot(), false);
});
