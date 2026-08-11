import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SubagentPanel.tsx", import.meta.url), "utf8");

test("renders live and completed subagent groups beside the chat", () => {
  assert.match(source, /className="subagent-panel"/);
  assert.match(source, /const running = subagents\.filter\(isSubagentActive\)/);
  assert.match(source, /const finished = subagents\.filter\(\(subagent\) => !isSubagentActive\(subagent\)\)/);
  assert.match(source, /t\("subagents\.history"\)/);
});

test("loads a selected subagent transcript after it finishes", () => {
  assert.match(source, /type: "get_subagent_messages"/);
  assert.match(source, /subagentId: subagent\.id/);
  assert.match(source, /active \? setInterval/);
  assert.match(source, /subagents\.transcriptUnavailable/);
});
