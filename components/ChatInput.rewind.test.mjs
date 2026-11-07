import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
	jsx: { runtime: "automatic" },
	tsconfigPaths: true,
});
const { BUILTIN_SLASH_COMMANDS } = await jiti.import("./ChatInput.tsx");

test("registers /rewind as the only local rewind command", () => {
	assert.ok(Array.isArray(BUILTIN_SLASH_COMMANDS), "BUILTIN_SLASH_COMMANDS must be an exported array");

	const matches = BUILTIN_SLASH_COMMANDS.filter((command) => command.name === "rewind");
	assert.equal(matches.length, 1, "rewind must be registered exactly once");
	assert.equal(matches[0].descriptionKey, "chat.commandRewind");
	assert.equal(
		BUILTIN_SLASH_COMMANDS.some((command) => command.name === "branch"),
		false,
		"/branch is an alias of /rewind and must not be registered separately",
	);
});
