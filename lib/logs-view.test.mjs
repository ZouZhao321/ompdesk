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
    "2026-10-24 15:28 · current file",
  );
  assert.equal(
    formatFileLabel({ name: "omp.2026-10-24.1802.log", size: 1, modifiedAt: "", current: false }),
    "2026-10-24 18:02",
  );
  assert.equal(
    formatFileLabel({ name: "omp.2026-10-24.1528.log.3", size: 1, modifiedAt: "", current: false }),
    "2026-10-24 15:28 · rotation 3",
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
    buildLogsRequest({
      file: "omp.2026-10-24.1.log",
      cursor: 120,
      fingerprint: "1:2:3:abcd",
      level: "warn",
      keyword: "needle",
      limit: 50,
    }),
    "/api/logs?file=omp.2026-10-24.1.log&cursor=120&fingerprint=1%3A2%3A3%3Aabcd&level=warn&q=needle&limit=50",
  );
  // A fresh read asks for the tail; the fingerprint is meaningless without a cursor.
  assert.equal(
    buildLogsRequest({ file: "omp.2026-10-24.1.log", cursor: 0, tail: true, fingerprint: "ignored" }),
    "/api/logs?file=omp.2026-10-24.1.log&tail=1",
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

test("appends strictly newer pages without re-sorting", () => {
  const existing = [entry(0, "a"), entry(10, "b")];
  const incoming = [entry(20, "c"), entry(30, "d")];
  const appended = mergeLogEntries(existing, incoming);
  assert.deepEqual(appended.map((item) => item.message), ["a", "b", "c", "d"]);
  assert.notEqual(appended, existing, "the existing buffer must not be mutated");
  assert.deepEqual(existing.map((item) => item.message), ["a", "b"]);

  const capped = mergeLogEntries(existing, incoming, 3);
  assert.deepEqual(capped.map((item) => item.message), ["b", "c", "d"]);

  // State proof for autoscroll: once the visible cap is reached, the length
  // stops changing while the newest offset keeps advancing.
  const full = [entry(0, "a"), entry(10, "b"), entry(20, "c")];
  const next = mergeLogEntries(full, [entry(30, "d")], 3);
  assert.equal(next.length, full.length);
  assert.ok(next[next.length - 1].offset > full[full.length - 1].offset);
});

test("describes loading, error, empty, filtered, and catching-up states distinctly", () => {
  const base = { loading: false, error: null, fileCount: 0, entryCount: 0, level: "all", keyword: "" };

  assert.equal(describeLogsState({ ...base, loading: true }).kind, "loading");
  assert.equal(describeLogsState({ ...base, loading: true, fileCount: 1 }).kind, "loading");
  assert.equal(describeLogsState({ ...base, error: "boom" }).kind, "error");
  assert.equal(describeLogsState(base).kind, "no-files");
  assert.equal(describeLogsState({ ...base, fileCount: 1 }).kind, "empty");
  assert.equal(describeLogsState({ ...base, fileCount: 1, level: "warn" }).kind, "no-matches");
  assert.equal(describeLogsState({ ...base, fileCount: 1, keyword: "x" }).kind, "no-matches");
  assert.equal(describeLogsState({ ...base, fileCount: 1, entryCount: 3 }).kind, "ready");

  // A truncated page with no matches yet is provisional, not "no matches".
  assert.equal(
    describeLogsState({ ...base, fileCount: 1, keyword: "x", catchingUp: true }).kind,
    "catching-up",
  );
  // Existing entries win over the catching-up placeholder.
  assert.equal(
    describeLogsState({ ...base, fileCount: 1, entryCount: 2, catchingUp: true }).kind,
    "ready",
  );
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

test("pins the followed file when follow is turned off without a selection", () => {
  assert.equal(
    selectFileAfterFollow(false, null, "omp.2026-10-24.1528.log"),
    "omp.2026-10-24.1528.log",
  );
  assert.equal(
    selectFileAfterFollow(false, "omp.2026-10-24.1528.log.2", "omp.2026-10-24.1528.log"),
    "omp.2026-10-24.1528.log.2",
  );
  assert.equal(selectFileAfterFollow(true, "omp.2026-10-24.1528.log.2", "current"), null);
  assert.equal(selectFileAfterFollow(false, null, null), null);
});

test("renders full JSON for parsed entries and preserves unparseable text", () => {
  assert.match(entryDetail(entry(0, "http.request", { requestId: "req-1" })), /"requestId": "req-1"/);
  assert.equal(
    entryDetail({ ...entry(0, "raw line"), parseError: "Unexpected token", raw: "raw line" }),
    "parseError: Unexpected token\n\nraw line",
  );
});
