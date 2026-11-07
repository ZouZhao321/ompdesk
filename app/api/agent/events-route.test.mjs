import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const agentEventsSource = await readFile(new URL("./[id]/events/route.ts", import.meta.url), "utf8");
const runningEventsSource = await readFile(new URL("./running/events/route.ts", import.meta.url), "utf8");
const lifecycleSource = await readFile(new URL("../../../lib/sse-lifecycle.ts", import.meta.url), "utf8");

test("agent SSE projects SDK events onto the fields consumed by the web client", () => {
	assert.match(agentEventsSource, /import \{ toClientEvent \} from "@\/lib\/agent-client-events"/);
	assert.match(agentEventsSource, /const clientEvent = toClientEvent\(event\)/);
	assert.doesNotMatch(agentEventsSource, /function toClientEvent/);
});

test("SSE routes delegate frame encoding to one shared stream lifecycle", () => {
	assert.equal((lifecycleSource.match(/new TextEncoder\(\)/g) ?? []).length, 1);
	assert.match(lifecycleSource, /encoder\.encode\(/);
	for (const source of [agentEventsSource, runningEventsSource]) {
		assert.equal((source.match(/new TextEncoder\(\)/g) ?? []).length, 0);
		assert.equal((source.match(/openSseStream\(/g) ?? []).length, 1);
		assert.match(source, /streamSession\?\.cancel\(\)/);
	}
});
