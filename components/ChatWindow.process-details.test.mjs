import assert from "node:assert/strict";
import test from "node:test";

import { readSource } from "../test-support/source-text";

const source = await readSource(new URL("./ChatWindow.tsx", import.meta.url));

test("unfolds process details without a final answer or with a provider error", () => {
  // 没有正式回答时整轮都是过程；有正式回答但过程组里带着 provider 错误时也要展开，
  // 否则错误横幅被折叠起来，只剩一个计数。这条只为最新一轮保留：历史轮曾出错后
  // 重试成功的会一起撑开首屏，挂载量随错误轮数增长。
  assert.match(
    source,
    /const expanded = useTranscriptExpanded\(sessionId, anchorEntryId, PROCESS_DETAILS_PART, defaultExpanded\)/,
  );
  assert.match(
    source,
    /<ProcessDetailsGroup[\s\S]*?defaultExpanded=\{!item\.finalAnswerMessage \|\| \(item\.hasProcessError && item\.isLastTurn\)\}/,
  );
});

test("keys the process group on the turn's question anchor", () => {
  assert.match(source, /const turnAnchorEntryId = item\.key/);
  assert.match(source, /<ProcessDetailsGroup[\s\S]*?anchorEntryId=\{turnAnchorEntryId\}/);
});
