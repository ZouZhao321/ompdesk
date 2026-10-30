import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("expands process details when a completed turn has no final answer", () => {
  assert.match(source, /const expanded = useTranscriptExpanded\(sessionId, anchorEntryId, PROCESS_DETAILS_PART, defaultExpanded\)/);
  assert.match(
    source,
    /<ProcessDetailsGroup[\s\S]*?defaultExpanded=\{!finalAnswerMessage\}/,
  );
});

test("keys the process group on the turn's question anchor", () => {
  assert.match(source, /const turnAnchorEntryId = entryIds\[userIdx\] \?\? `turn-\$\{userIdx\}`/);
  assert.match(source, /<ProcessDetailsGroup[\s\S]*?anchorEntryId=\{turnAnchorEntryId\}/);
});
