import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

/** 从 `useCallback(` 起按括号配对取出整段初始化表达式，结果不受缩进与折行影响。 */
function callbackSource(marker) {
	const start = source.indexOf(`${marker} = useCallback(`);
	assert.ok(start >= 0, `${marker} not found`);
	const open = source.indexOf("(", start);
	let depth = 0;
	for (let index = open; index < source.length; index += 1) {
		if (source[index] === "(") depth += 1;
		else if (source[index] === ")") {
			depth -= 1;
			if (depth === 0) return `${source.slice(start, index + 1)};`;
		}
	}
	assert.fail(`${marker} callback is not closed`);
}

// Execute the production callback with a window double, rather than duplicating
// its URL selection logic in the test.
const createHistoryCallback = new Function(
	"selectedSession",
	"window",
	"useCallback",
	`${callbackSource("const handleViewFullHistory")}\nreturn handleViewFullHistory;`,
);

for (const { name, selectedSession, expectedId } of [
	{
		name: "History follows the selected runtime after a missed identity update",
		selectedSession: { id: "history-a", runtimeId: "runtime:history-r" },
		expectedId: "runtime:history-r",
	},
	{
		name: "History preserves historical session IDs without a runtime handle",
		selectedSession: { id: "history-a" },
		expectedId: "history-a",
	},
	{
		name: "History does nothing without a selected session",
		selectedSession: null,
	},
]) {
	test(name, () => {
		const opened = [];
		const callback = createHistoryCallback(
			selectedSession,
			{ open: (...args) => opened.push(args) },
			(callback) => callback,
		);
		callback();
		assert.deepEqual(
			opened,
			expectedId
				? [[`/api/sessions/${encodeURIComponent(expectedId)}/export?inline=1`, "_blank", "noopener,noreferrer"]]
				: [],
		);
	});
}
