import assert from "node:assert/strict";
import test from "node:test";
import { parseCompactionSummary } from "./compaction-summary.ts";

test("separates pi file metadata tags from the visible compaction summary", () => {
  const parsed = parseCompactionSummary(`## Goal
Keep the important user intent.

<read-files>
/tmp/a.ts
/tmp/b.ts
</read-files>

<modified-files>
/tmp/changed.ts
</modified-files>`);

  assert.equal(parsed.body, "## Goal\nKeep the important user intent.");
  assert.deepEqual(parsed.readFiles, ["/tmp/a.ts", "/tmp/b.ts"]);
  assert.deepEqual(parsed.modifiedFiles, ["/tmp/changed.ts"]);
});

test("leaves normal summaries unchanged", () => {
  const summary = "## Goal\nNo file metadata here.";

  assert.deepEqual(parseCompactionSummary(summary), {
    body: summary,
    readFiles: [],
    modifiedFiles: [],
  });
});

test("keeps file-like tags that are part of the summary body", () => {
  const summary = `## Critical Context
The user asked what this compact metadata means: <read-files>example</read-files>.

More summary text after the mention.`;

  assert.deepEqual(parseCompactionSummary(summary), {
    body: summary,
    readFiles: [],
    modifiedFiles: [],
  });
});

test("tolerates trailing blank lines after the metadata block", () => {
  const parsed = parseCompactionSummary(`## Goal
Done.

<read-files>
/tmp/a.ts
</read-files>


`);

  assert.equal(parsed.body, "## Goal\nDone.");
  assert.deepEqual(parsed.readFiles, ["/tmp/a.ts"]);
});

test("parses metadata blocks with CRLF line endings", () => {
  const parsed = parseCompactionSummary("## Goal\r\nDone.\r\n\r\n<read-files>\r\n/tmp/a.ts\r\n</read-files>\r\n");

  assert.equal(parsed.body, "## Goal\r\nDone.");
  assert.deepEqual(parsed.readFiles, ["/tmp/a.ts"]);
});

test("keeps an unmatched closing tag as summary text", () => {
  const summary = "## Goal\nDone.\n\n</read-files>";

  assert.deepEqual(parseCompactionSummary(summary), {
    body: summary,
    readFiles: [],
    modifiedFiles: [],
  });
});

test("keeps a tag block that is glued to the summary body", () => {
  const summary = "## Goal\nDone.\n<read-files>\n/tmp/a.ts\n</read-files>";

  assert.deepEqual(parseCompactionSummary(summary), {
    body: summary,
    readFiles: [],
    modifiedFiles: [],
  });
});
