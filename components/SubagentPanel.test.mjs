import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SubagentPanel.tsx", import.meta.url), "utf8");
const shellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("renders live and completed subagent groups in the right panel tab", () => {
	assert.match(source, /className="subagent-panel"/);
	assert.match(source, /const running = subagents\.filter\(isSubagentActive\)/);
	assert.match(source, /const finished = subagents\.filter\(\(subagent\) => !isSubagentActive\(subagent\)\)/);
	assert.match(source, /t\("subagents\.history"\)/);
	assert.match(shellSource, /activePanelTab\?\.kind === "subagents"/);
	assert.match(shellSource, /MemoSubagentPanel/);
	assert.match(shellSource, /const MemoSubagentPanel = memo\(SubagentPanel\)/);
	assert.match(shellSource, /handleToggleViewTab\("subagents"\)/);
	assert.doesNotMatch(shellSource, /subagent-column/);
	assert.doesNotMatch(stylesSource, /\.subagent-column/);
});

test("loads a selected subagent transcript while visible and refetches when it ends", () => {
	assert.match(source, /type: "get_subagent_messages"/);
	assert.match(source, /subagentId: subagent\.id/);
	assert.match(source, /const wasVisible = prevVisibleRef\.current/);
	assert.match(source, /if \(!wasVisible \|\| !active\) void loadTranscript\(\)/);
	assert.match(source, /const interval = setInterval\(\(\) => void loadTranscript\(\), 1000\)/);
	assert.match(source, /if \(requestId === requestRef\.current\) \{[\s\S]*?inFlightRef\.current = false/);
	assert.match(source, /prevVisibleRef\.current = false;/);
	assert.match(source, /pendingRef\.current = true;/);
	assert.match(source, /subagents\.transcriptUnavailable/);
});
