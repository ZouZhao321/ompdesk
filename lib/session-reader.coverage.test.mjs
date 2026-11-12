import assert from "node:assert/strict";
import { mock } from "bun:test";
import test from "node:test";

const realSdk = await import("@oh-my-pi/pi-coding-agent");
const realAgentCore = await import("@oh-my-pi/pi-agent-core");

let contextMessages = [];

mock.module("@oh-my-pi/pi-coding-agent", () => ({
  ...realSdk,
  buildSessionContext: () => ({ models: { default: "provider/model" }, messages: contextMessages }),
}));

mock.module("@oh-my-pi/pi-agent-core", () => ({
  ...realAgentCore,
  Tokenizer: class {
    countMessage() {
      return 7;
    }
  },
}));

mock.module("@oh-my-pi/pi-agent-core/compaction", () => ({
  calculatePromptTokens: (usage) => usage.input + (usage.cacheRead ?? 0),
  hasContextTokenUsage: (usage) => typeof usage.input === "number",
}));

mock.module("./omp-runtime", () => ({
  getOmpRuntime: async () => ({
    modelRegistry: { find: () => ({ contextWindow: 200_000 }) },
  }),
}));

const { getHistoricalContextUsage } = await import("./session-reader.ts");
mock.restore();

function assistantEntry(message, timestamp = "2026-01-01T00:00:00.000Z") {
  return {
    id: "entry-1",
    parentId: null,
    type: "message",
    timestamp,
    message,
  };
}

test("anchors on the provider's context snapshot", async () => {
  const assistant = {
    role: "assistant",
    stopReason: "stop",
    timestamp: "2026-01-01T00:00:00.000Z",
    usage: { input: 999, output: 10, cacheRead: 0, cacheWrite: 0 },
    contextSnapshot: { promptTokens: 123 },
  };
  const entries = [assistantEntry(assistant)];
  contextMessages = [assistant];

  const usage = await getHistoricalContextUsage(entries);

  assert.deepEqual(usage, { tokens: 123, contextWindow: 200_000, percent: (123 / 200_000) * 100 });
});

test("falls back to the usage counters when no snapshot was recorded", async () => {
  const assistant = {
    role: "assistant",
    stopReason: "stop",
    timestamp: "2026-01-01T00:00:00.000Z",
    usage: { input: 40, output: 10, cacheRead: 2, cacheWrite: 0 },
  };
  const entries = [assistantEntry(assistant)];
  contextMessages = [assistant];

  const usage = await getHistoricalContextUsage(entries);

  assert.equal(usage.tokens, 42);
});

test("returns undefined when no usable assistant response exists", async () => {
  const entries = [
    assistantEntry({
      role: "assistant",
      stopReason: "aborted",
      timestamp: "2026-01-01T00:00:00.000Z",
      usage: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextSnapshot: { promptTokens: 10 },
    }),
  ];
  contextMessages = [];

  assert.equal(await getHistoricalContextUsage(entries), undefined);
});
