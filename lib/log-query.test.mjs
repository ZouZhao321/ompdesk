import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const {
  LogQueryError,
  completeLinesEnd,
  listLogFiles,
  parseLogsQuery,
  readLogDownload,
  readLogPage,
  validateLogFileName,
} = await import("./log-query.ts");

const PID = 4242;
const DAY = "2026-10-24";
const FILE = `omp.${DAY}.${PID}.log`;

function createTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-log-query-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeLog(dir, name, lines, trailingNewline = true) {
  const body = lines.map((line) => typeof line === "string" ? line : JSON.stringify(line));
  fs.writeFileSync(path.join(dir, name), body.join("\n") + (trailingNewline ? "\n" : ""));
}

function record(level, message, extra = {}) {
  return {
    timestamp: "2026-10-24T15:00:00.000+08:00",
    level,
    pid: PID,
    message,
    source: "ompdesk",
    subsystem: "http",
    ...extra,
  };
}

function isQueryError(status) {
  return (error) => error instanceof LogQueryError && error.status === status;
}

test("lists only the current PID's files and marks the newest write as active", (t) => {
  const dir = createTempDir(t);
  writeLog(dir, FILE, [record("info", "one")]);
  writeLog(dir, `${FILE}.1`, [record("info", "two")]);
  writeLog(dir, `omp.2026-10-23.${PID}.log`, [record("info", "older")]);
  writeLog(dir, "omp.2026-10-24.9999.log", [record("info", "other process")]);
  writeLog(dir, "models.json", [{}]);

  const old = new Date("2026-10-23T01:00:00Z");
  const older = new Date("2026-10-22T01:00:00Z");
  const current = new Date("2026-10-24T02:00:00Z");
  fs.utimesSync(path.join(dir, `${FILE}.1`), current, current);
  fs.utimesSync(path.join(dir, FILE), old, old);
  fs.utimesSync(path.join(dir, `omp.2026-10-23.${PID}.log`), older, older);

  const files = listLogFiles(dir, PID);
  assert.deepEqual(files.map((file) => file.name), [`${FILE}.1`, FILE, `omp.2026-10-23.${PID}.log`]);
  assert.equal(files[0].current, true);
  assert.equal(files[1].current, false);
  assert.ok(files.every((file) => file.size > 0));
  assert.ok(files.every((file) => Number.isFinite(Date.parse(file.modifiedAt))));
});

test("paginates by raw byte offset without duplicating or losing lines", (t) => {
  const dir = createTempDir(t);
  const lines = Array.from({ length: 5 }, (_, index) => record("info", `message-${index}`));
  writeLog(dir, FILE, lines);

  const first = readLogPage({ directory: dir, pid: PID, limit: 2 });
  assert.deepEqual(first.entries.map((entry) => entry.message), ["message-0", "message-1"]);
  assert.equal(first.entries[0].offset, 0);
  assert.equal(first.entries[1].offset, Buffer.byteLength(`${JSON.stringify(lines[0])}\n`));
  assert.equal(first.nextCursor, Buffer.byteLength(`${JSON.stringify(lines[0])}\n${JSON.stringify(lines[1])}\n`));
  assert.equal(first.truncated, true);
  assert.equal(first.file?.name, FILE);

  const second = readLogPage({ directory: dir, pid: PID, limit: 2, cursor: first.nextCursor });
  assert.deepEqual(second.entries.map((entry) => entry.message), ["message-2", "message-3"]);

  const third = readLogPage({ directory: dir, pid: PID, limit: 2, cursor: second.nextCursor });
  assert.deepEqual(third.entries.map((entry) => entry.message), ["message-4"]);
  assert.equal(third.truncated, false);
  assert.equal(third.nextCursor, fs.statSync(path.join(dir, FILE)).size);

  const allOffsets = [...first.entries, ...second.entries, ...third.entries].map((entry) => entry.offset);
  assert.equal(new Set(allOffsets).size, allOffsets.length);
  assert.deepEqual(allOffsets, [...allOffsets].sort((left, right) => left - right));
});

test("filters by minimum level and keyword after parsing", (t) => {
  const dir = createTempDir(t);
  writeLog(dir, FILE, [
    record("error", "network failed", { requestId: "r1" }),
    record("warn", "slow request", { requestId: "r2" }),
    record("info", "request done needle", { requestId: "r3" }),
    record("debug", "cache hit", { requestId: "r4" }),
    "not json at all",
  ]);

  const warnings = readLogPage({ directory: dir, pid: PID, level: "warn" });
  assert.deepEqual(warnings.entries.map((entry) => entry.level), ["error", "warn"]);

  const keyword = readLogPage({ directory: dir, pid: PID, keyword: "needle" });
  assert.deepEqual(keyword.entries.map((entry) => entry.message), ["request done needle"]);

  const combined = readLogPage({ directory: dir, pid: PID, level: "error", keyword: "needle" });
  assert.equal(combined.entries.length, 0);
  assert.equal(combined.nextCursor, fs.statSync(path.join(dir, FILE)).size);
});

test("preserves unparseable lines with parseError and the original text", (t) => {
  const dir = createTempDir(t);
  writeLog(dir, FILE, ["not json at all", "{\"level\":\"info\",", "42"]);

  const page = readLogPage({ directory: dir, pid: PID });
  assert.equal(page.entries.length, 3);
  assert.equal(page.entries[0].raw, "not json at all");
  assert.ok(page.entries[0].parseError);
  assert.equal(page.entries[0].source, "sdk");
  assert.ok(page.entries[1].parseError);
  assert.equal(page.entries[2].parseError, "Expected a JSON object");
});

test("fills source with sdk for records that do not carry one", (t) => {
  const dir = createTempDir(t);
  writeLog(dir, FILE, [{ timestamp: "2026-10-24T15:00:00.000+08:00", level: "info", message: "sdk.event" }]);

  const [entry] = readLogPage({ directory: dir, pid: PID }).entries;
  assert.equal(entry.source, "sdk");
  assert.equal(entry.subsystem, null);
});

test("parses a final line that has no trailing newline", (t) => {
  const dir = createTempDir(t);
  writeLog(dir, FILE, [record("info", "only line")], false);

  const page = readLogPage({ directory: dir, pid: PID });
  assert.deepEqual(page.entries.map((entry) => entry.message), ["only line"]);
  assert.equal(page.truncated, false);
});

test("rejects traversal, separators, absolute paths, and another PID's file", () => {
  for (const name of [
    `../${FILE}`,
    `logs/${FILE}`,
    `..\\${FILE}`,
    "/etc/passwd",
    "..",
    "omp.2026-10-24.9999.log",
    "omp.log",
    `${FILE}\0.txt`,
  ]) {
    assert.throws(() => validateLogFileName(name, PID), isQueryError(400), name);
  }
  assert.equal(validateLogFileName(FILE, PID), FILE);
  assert.equal(validateLogFileName(`${FILE}.3`, PID), `${FILE}.3`);
});

test("rejects symlinked log files", (t) => {
  const dir = createTempDir(t);
  const target = path.join(dir, `${FILE}.real`);
  fs.writeFileSync(target, `${JSON.stringify(record("info", "linked"))}\n`);
  const link = path.join(dir, `${FILE}.1`);
  try {
    fs.symlinkSync(target, link);
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      t.skip("symlinks are not available in this environment");
      return;
    }
    throw error;
  }

  assert.throws(() => readLogPage({ directory: dir, pid: PID, file: `${FILE}.1` }), isQueryError(400));
});

test("reports a missing or wrong-owner file as not found", (t) => {
  const dir = createTempDir(t);
  assert.throws(() => readLogPage({ directory: dir, pid: PID, file: FILE }), isQueryError(404));
  assert.throws(() => readLogPage({ directory: dir, pid: PID, file: `omp.2026-10-24.9999.log` }), isQueryError(400));
});

test("downloads the validated file verbatim", (t) => {
  const dir = createTempDir(t);
  writeLog(dir, FILE, [record("info", "download me")]);
  const expected = fs.readFileSync(path.join(dir, FILE));

  const download = readLogDownload(FILE, { directory: dir, pid: PID });
  assert.deepEqual(download.data, expected);
  assert.equal(download.file.name, FILE);
  assert.equal(download.file.current, true);
  assert.throws(() => readLogDownload(`../${FILE}`, { directory: dir, pid: PID }), isQueryError(400));
});

test("validates query parameters before reading anything", () => {
  assert.deepEqual(parseLogsQuery(new URLSearchParams()), {
    file: null,
    cursor: 0,
    limit: 200,
    level: "all",
    keyword: "",
    download: false,
  });
  assert.deepEqual(parseLogsQuery(new URLSearchParams({ file: FILE, cursor: "10", limit: "5", level: "WARN", q: "needle", download: "1" })), {
    file: FILE,
    cursor: 10,
    limit: 5,
    level: "warn",
    keyword: "needle",
    download: true,
  });

  assert.throws(() => parseLogsQuery(new URLSearchParams({ cursor: "-1" })), isQueryError(400));
  assert.throws(() => parseLogsQuery(new URLSearchParams({ cursor: "abc" })), isQueryError(400));
  assert.throws(() => parseLogsQuery(new URLSearchParams({ limit: "0" })), isQueryError(400));
  assert.throws(() => parseLogsQuery(new URLSearchParams({ limit: "1001" })), isQueryError(400));
  assert.throws(() => parseLogsQuery(new URLSearchParams({ level: "trace" })), isQueryError(400));
  assert.throws(() => parseLogsQuery(new URLSearchParams({ q: "x".repeat(201) })), isQueryError(400));
  assert.throws(() => parseLogsQuery(new URLSearchParams({ file: "../x" })), isQueryError(400));
});

test("byte caps mark the page truncated and advance the cursor", (t) => {
  const dir = createTempDir(t);
  const lines = Array.from({ length: 5_000 }, (_, index) => record("info", `line-${index}`, { detail: "x".repeat(300) }));
  writeLog(dir, FILE, lines);

  const page = readLogPage({ directory: dir, pid: PID, limit: 1_000 });
  assert.ok(page.entries.length > 0);
  assert.ok(page.entries.length < lines.length);
  assert.equal(page.truncated, true);
  assert.ok(page.nextCursor > 0);
  assert.ok(page.nextCursor < fs.statSync(path.join(dir, FILE)).size);
});

test("never scans bytes beyond a zero-byte read for a line boundary", (t) => {
  // Simulate a rotation between stat and read: none of these bytes were read,
  // but the buffer still holds a newline from an earlier allocation.
  const unread = Buffer.allocUnsafe(16);
  unread.fill(0);
  Buffer.from("\nleaked-unread-line").copy(unread, 0);

  assert.equal(completeLinesEnd(unread, 0, false), 0);
  assert.equal(completeLinesEnd(unread, 1, false), 1);
  assert.equal(completeLinesEnd(Buffer.from("line\npartial"), 4, false), 4);
  assert.equal(completeLinesEnd(Buffer.from("line\npartial"), 13, false), 5);
  assert.equal(completeLinesEnd(Buffer.from("line\npartial"), 13, true), 13);

  const dir = createTempDir(t);
  writeLog(dir, FILE, [record("info", "one")]);
  const size = fs.statSync(path.join(dir, FILE)).size;
  const atEnd = readLogPage({ directory: dir, pid: PID, cursor: size });
  assert.deepEqual(atEnd.entries, []);
  assert.equal(atEnd.nextCursor, size);
  assert.equal(atEnd.reset, false);
});

test("resets when a cursor belongs to a shrunken same-name file", (t) => {
  const dir = createTempDir(t);
  writeLog(dir, FILE, [record("info", "one"), record("info", "two"), record("info", "three")]);

  const full = readLogPage({ directory: dir, pid: PID });
  assert.equal(full.reset, false);
  assert.deepEqual(full.entries.map((entry) => entry.message), ["one", "two", "three"]);
  assert.equal(full.nextCursor, fs.statSync(path.join(dir, FILE)).size);

  // Same basename, shorter content: the writer restarted the file.
  writeLog(dir, FILE, [record("info", "restarted")]);
  const smaller = fs.statSync(path.join(dir, FILE)).size;
  assert.ok(full.nextCursor > smaller);

  const reset = readLogPage({ directory: dir, pid: PID, cursor: full.nextCursor });
  assert.equal(reset.reset, true);
  assert.deepEqual(reset.entries.map((entry) => entry.message), ["restarted"]);
  assert.equal(reset.entries[0].offset, 0);
  assert.equal(reset.nextCursor, smaller);

  const caughtUp = readLogPage({ directory: dir, pid: PID, cursor: reset.nextCursor });
  assert.equal(caughtUp.reset, false);
  assert.deepEqual(caughtUp.entries, []);
});
