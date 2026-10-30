import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("unfolds process details without a final answer or with a provider error", () => {
  // 没有正式回答时整轮都是过程；有正式回答但过程组里带着 provider 错误时也要展开，
  // 否则错误横幅被折叠起来，只剩一个计数。
  assert.match(source, /const expanded = useTranscriptExpanded\(sessionId, anchorEntryId, PROCESS_DETAILS_PART, defaultExpanded\)/);
  assert.match(
    source,
    /<ProcessDetailsGroup[\s\S]*?defaultExpanded=\{!item\.finalAnswerMessage \|\| item\.hasProcessError\}/,
  );
});

test("keys the process group on the turn's question anchor", () => {
  assert.match(source, /const turnAnchorEntryId = item\.key/);
  assert.match(source, /<ProcessDetailsGroup[\s\S]*?anchorEntryId=\{turnAnchorEntryId\}/);
});
