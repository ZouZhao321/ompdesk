import assert from "node:assert/strict";
import test from "node:test";
import { readSourceFile } from "../../../test-support/source-text.ts";

test("model-role PUT writes global roles through canonical Settings and re-reads the target scope", async () => {
	const source = await readSourceFile(new URL("./route.ts", import.meta.url));
	const putSource = source.slice(source.indexOf("export const PUT"));

	assert.match(putSource, /const runtime = await getOmpRuntime\(\)/);
	assert.match(
		putSource,
		/const settingsToWrite = scope === "global"\s*\?\s*runtime\.settings\s*:\s*await getSettingsForCwd\(result\.cwd\)/s,
	);
	assert.match(putSource, /await settingsToWrite\.flush\(\)/);
	assert.match(putSource, /const settings = await getSettingsForCwd\(result\.cwd\)/);
});
