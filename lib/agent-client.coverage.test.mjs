import assert from "node:assert/strict";
import test from "node:test";

const { canApplySessionIdentity, isPromptRejectedError, AgentCommandError, sendAgentCommand } = await import(
  "./agent-client.ts"
);

test("treats an unparseable success body as an empty payload", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let requestedUrl = "";
  globalThis.fetch = async (url) => {
    requestedUrl = url;
    return new Response("not json", { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const result = await sendAgentCommand("session-1", { type: "ping" }, { current: "runtime-1" });

  assert.equal(result, undefined);
  assert.equal(requestedUrl, "/api/agent/runtime-1");
});

test("accepts an identity only while the request still owns the selection", () => {
  const current = { sessionId: "session-1", runtimeId: "runtime-1" };
  const identity = { sessionId: "session-1", runtimeId: "runtime-1" };
  const request = { sessionId: "session-1", runtimeId: "runtime-1" };

  assert.equal(canApplySessionIdentity(current, identity, request), true);
  assert.equal(
    canApplySessionIdentity(
      { sessionId: "session-1", runtimeId: "runtime-9" },
      { sessionId: "session-2", runtimeId: "runtime-1" },
      { sessionId: "session-1", runtimeId: "runtime-9" },
    ),
    true,
    "the request still owns the runtime and matches the session",
  );
  assert.equal(
    canApplySessionIdentity({ sessionId: "session-2", runtimeId: "runtime-2" }, identity, {
      sessionId: "session-1",
      runtimeId: "runtime-1",
    }),
    false,
    "another client moved the selection",
  );
});

test("classifies a definitively rejected prompt and an expired runtime", () => {
  assert.equal(isPromptRejectedError(new AgentCommandError("busy", 409, "prompt_rejected", false)), true);
  assert.equal(isPromptRejectedError(new AgentCommandError("gone", 404, "runtime_expired", false)), true);
  assert.equal(isPromptRejectedError(new AgentCommandError("accepted", 409, "prompt_rejected", true)), false);
  assert.equal(isPromptRejectedError(new AgentCommandError("other", 500, "internal_error", false)), false);
});
