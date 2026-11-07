import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { isRewindInput } from "../lib/rewind.ts";

// Execute the real `sendQueued` / `handleSend` bodies so the busy-session guard
// is exercised as production code; only React state and props are doubles.
const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("ChatInput.tsx", source, ts.ScriptTarget.Latest, true);
const callbacks = new Map();
function collect(node) {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    ts.isCallExpression(node.initializer) &&
    node.initializer.expression.getText(ast) === "useCallback"
  ) {
    callbacks.set(node.name.text, node.initializer.arguments[0].getText(ast));
  }
  ts.forEachChild(node, collect);
}
collect(ast);

const callbackNames = ["sendQueued", "handleSend"];
for (const name of callbackNames) assert.ok(callbacks.has(name), `Missing callback: ${name}`);

// `isRewindInput` is injected from lib/rewind.ts so the whole-input predicate
// stays the real production implementation.
const { outputText } = ts.transpileModule(
  [
    "function buildCallbacks(env) {",
    "  const { value, attachedImages, isStreaming, onBuiltinCommand, onSend, onAudioUnlock, onPromptWithStreamingBehavior, onSteer, onFollowUp, clearInput, isRewindInput } = env;",
    `  const sendQueued = ${callbacks.get("sendQueued")};`,
    `  const handleSend = ${callbacks.get("handleSend")};`,
    "  return { sendQueued, handleSend };",
    "}",
  ].join("\n"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
);

const createChatInputCallbacks = new Function(`${outputText}\nreturn buildCallbacks;`)();

function harness({ value = "", attachedImages = [], isStreaming = false, builtinResult = { handled: true } } = {}) {
  const input = { value, cleared: false };
  const calls = [];
  const record = (name, ...args) => {
    calls.push([name, ...args]);
  };
  const clearInput = () => {
    record("clearInput");
    input.cleared = true;
    input.value = "";
  };
  const { sendQueued, handleSend } = createChatInputCallbacks({
    value: input.value,
    attachedImages,
    isStreaming,
    onBuiltinCommand: async (message) => {
      record("onBuiltinCommand", message);
      return builtinResult;
    },
    onSend: (...args) => record("onSend", ...args),
    onAudioUnlock: () => record("onAudioUnlock"),
    onPromptWithStreamingBehavior: (...args) => record("onPromptWithStreamingBehavior", ...args),
    onSteer: (...args) => record("onSteer", ...args),
    onFollowUp: (...args) => record("onFollowUp", ...args),
    clearInput,
    isRewindInput,
  });
  return { sendQueued, handleSend, input, calls, names: () => calls.map(([name]) => name) };
}

for (const [label, message] of [
  ["/rewind", "/rewind"],
  ["/branch", "/branch"],
]) {
  test(`sendQueued steers ${label} to the builtin dispatcher instead of the model`, () => {
    const h = harness({ value: message, isStreaming: true });

    h.sendQueued("steer");

    assert.deepEqual(
      h.calls.filter(([name]) => name === "onBuiltinCommand"),
      [["onBuiltinCommand", message]],
    );
    assert.equal(h.names().includes("onPromptWithStreamingBehavior"), false, "must not queue as a streaming prompt");
    assert.equal(h.names().includes("onSteer"), false, "must not steer the running agent");
    assert.equal(h.names().includes("onFollowUp"), false);
    assert.equal(h.names().includes("onSend"), false);
    assert.equal(h.names().filter((name) => name === "clearInput").length, 1);
    assert.equal(h.input.cleared, true);
    assert.equal(h.input.value, "");
  });
}

test("sendQueued still routes /rewind with trailing text through the normal streaming path", () => {
  const h = harness({ value: "/rewind now", isStreaming: true });

  h.sendQueued("steer");

  assert.equal(h.names().includes("onBuiltinCommand"), false, "whole-input guard only");
  assert.deepEqual(
    h.calls.filter(([name]) => name === "onPromptWithStreamingBehavior"),
    [["onPromptWithStreamingBehavior", "/rewind now", "steer", undefined]],
  );
  assert.equal(h.names().includes("onSteer"), false);
  assert.equal(h.names().filter((name) => name === "clearInput").length, 1);
});

test("handleSend on a busy bash-only session dispatches /rewind to the builtin handler", async () => {
  const h = harness({ value: "/rewind", isStreaming: true });

  await h.handleSend();

  assert.deepEqual(
    h.calls.filter(([name]) => name === "onBuiltinCommand"),
    [["onBuiltinCommand", "/rewind"]],
  );
  assert.equal(h.names().includes("onSend"), false, "busy session must not send a prompt");
  assert.equal(h.names().filter((name) => name === "clearInput").length, 1);
  assert.equal(h.input.cleared, true);
  assert.equal(h.input.value, "");
});

test("handleSend on a busy session leaves ordinary text untouched", async () => {
  const h = harness({ value: "hello", isStreaming: true });

  await h.handleSend();

  assert.deepEqual(h.calls, []);
  assert.equal(h.input.value, "hello");
  assert.equal(h.input.cleared, false);
});

test("handleSend dispatches /rewind to the builtin handler when the session is idle", async () => {
  const h = harness({ value: "/rewind", isStreaming: false });

  await h.handleSend();

  assert.deepEqual(
    h.calls.filter(([name]) => name === "onBuiltinCommand"),
    [["onBuiltinCommand", "/rewind"]],
  );
  assert.equal(h.names().includes("onSend"), false, "handled dispatch must not fall through to onSend");
  assert.equal(h.names().filter((name) => name === "clearInput").length, 1);
});

test("sendQueued queues image attachments for steer and follow-up", () => {
  const image = { data: "AQID", mimeType: "image/png", previewUrl: "data:image/png;base64,AQID" };
  const steer = harness({ value: "", attachedImages: [image], isStreaming: true });
  steer.sendQueued("steer");
  assert.deepEqual(
    steer.calls.filter(([name]) => name === "onSteer"),
    [["onSteer", "", [image]]],
  );
  assert.equal(steer.input.cleared, true);

  const follow = harness({ value: "", attachedImages: [image], isStreaming: true });
  follow.sendQueued("followup");
  assert.deepEqual(
    follow.calls.filter(([name]) => name === "onFollowUp"),
    [["onFollowUp", "", [image]]],
  );
  assert.equal(follow.input.cleared, true);
});

test("sendQueued keeps image attachments when a busy /rewind is rejected", () => {
  const image = { data: "AQID", mimeType: "image/png", previewUrl: "data:image/png;base64,AQID" };
  const h = harness({ value: "/rewind", attachedImages: [image], isStreaming: true });
  h.sendQueued("steer");
  assert.deepEqual(
    h.calls.filter(([name]) => name === "onBuiltinCommand"),
    [["onBuiltinCommand", "/rewind"]],
  );
  assert.equal(h.names().includes("clearInput"), false);
});
