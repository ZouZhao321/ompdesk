import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { BUILTIN_SLASH_COMMANDS } = await jiti.import("./ChatInput.tsx");

test("registers /branch and /rewind as local builtin slash commands", () => {
  assert.ok(Array.isArray(BUILTIN_SLASH_COMMANDS), "BUILTIN_SLASH_COMMANDS must be an exported array");

  for (const name of ["branch", "rewind"]) {
    const matches = BUILTIN_SLASH_COMMANDS.filter((command) => command.name === name);
    assert.equal(matches.length, 1, `${name} must be registered exactly once`);
    assert.equal(matches[0].descriptionKey, "chat.commandRewind");
  }
});
