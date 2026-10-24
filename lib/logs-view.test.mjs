import assert from "node:assert/strict";
import test from "node:test";

const {
  buildLogsRequest,
  describeLogsState,
  downloadLogUrl,
  entryDetail,
  formatFileLabel,
  formatFileSize,
  mergeLogEntries,
  selectFileAfterFollow,
  shouldPollLogs,
} = await import("./logs-view.ts");

function entry(offset, message, extra = {}) {
  return {
    offset,
    length: 20,
    raw: JSON.stringify({ level: "info", message, ...extra }),
    level: "info",
    timestamp: "2026-10-24T15:00:00.000+08:00",
    source: "ompdesk",
    subsystem: "http",
    message,
    fields: { level: "info", message, ...extra },
  };
}

test("formats file sizes and rotation labels", () => {
  assert.equal(formatFileSize(0), "0 B");
  assert.equal(formatFileSize(1_536), "1.5 KB");
  assert.equal(formatFileSize(3 * 1_024 * 1_024), "3.0 MB");
  assert.equal(formatFileSize(Number.NaN), "—");

  assert.equal(
    formatFileLabel({ name: "omp.2026-10-24.1528.log", size: 1, modifiedAt: "", current: true }),
    "2026-10-24 · current file",
  );
  assert.equal(
    formatFileLabel({ name: "omp.2026-10-24.1528.log.3", size: 1, modifiedAt: "", current: false }),
    "2026-10-24 · rotation 3",
  );
  assert.equal(formatFileLabel({ name: "custom.log", size: 1, modifiedAt: "", current: false }), "custom.log");
});

test("builds cursor requests and download links", () => {
  assert.equal(buildLogsRequest({ file: null, cursor: 0, level: "all", keyword: "" }), "/api/logs");
  assert.equal(
    buildLogsRequest({ file: "omp.2026-10-24.1.log", cursor: 120, level: "warn", keyword: "needle", limit: 50 }),
    "/api/logs?file=omp.2026-10-24.1.log&cursor=120&level=warn&q=needle&limit=50",
  );
  assert.equal(
    downloadLogUrl("omp.2026-10-24.1.log"),
    "/api/logs?download=1&file=omp.2026-10-24.1.log",
  );
});

test("merges cursor pages by offset and caps the buffer", () => {
  const merged = mergeLogEntries([entry(0, "a"), entry(10, "b")], [entry(10, "b2"), entry(20, "c")]);
  assert.deepEqual(merged.map((item) => item.message), ["a", "b2", "c"]);

  const capped = mergeLogEntries([entry(0, "a"), entry(10, "b"), entry(20, "c")], [], 2);
  assert.deepEqual(capped.map((item) => item.message), ["b", "c"]);
});

test("describes loading, error, empty, and filtered states distinctly", () => {
  const base = { loading: false, error: null, fileCount: 0, entryCount: 0, level: "all", keyword: "" };

  assert.equal(describeLogsState({ ...base, loading: true }).kind, "loading");
  assert.equal(describeLogsState({ ...base, loading: true, fileCount: 1 }).kind, "loading");
  assert.equal(describeLogsState({ ...base, error: "boom" }).kind, "error");
  assert.equal(describeLogsState(base).kind, "no-files");
  assert.equal(describeLogsState({ ...base, fileCount: 1 }).kind, "empty");
  assert.equal(describeLogsState({ ...base, fileCount: 1, level: "warn" }).kind, "no-matches");
  assert.equal(describeLogsState({ ...base, fileCount: 1, keyword: "x" }).kind, "no-matches");
  assert.equal(describeLogsState({ ...base, fileCount: 1, entryCount: 3 }).kind, "ready");
});

test("stops polling for hidden tabs and the pause button", () => {
  assert.equal(shouldPollLogs(false, false), true);
  assert.equal(shouldPollLogs(true, false), false);
  assert.equal(shouldPollLogs(false, true), false);
  assert.equal(shouldPollLogs(true, true), false);
});

test("enabling follow clears a rotated file selection", () => {
  assert.equal(selectFileAfterFollow(true, "omp.2026-10-24.1528.log.2"), null);
  assert.equal(selectFileAfterFollow(true, null), null);
  assert.equal(selectFileAfterFollow(false, "omp.2026-10-24.1528.log.2"), "omp.2026-10-24.1528.log.2");
  assert.equal(selectFileAfterFollow(false, null), null);
});

test("renders full JSON for parsed entries and preserves unparseable text", () => {
  assert.match(entryDetail(entry(0, "http.request", { requestId: "req-1" })), /"requestId": "req-1"/);
  assert.equal(
    entryDetail({ ...entry(0, "raw line"), parseError: "Unexpected token", raw: "raw line" }),
    "parseError: Unexpected token\n\nraw line",
  );
});
