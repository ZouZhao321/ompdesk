import assert from "node:assert/strict";
import test from "node:test";
import { aggregateCoverage, indexByPath, parseLcov } from "./lcov.ts";

function record(path, { lines = [], lf, lh, fnf, fnh } = {}) {
  const rows = [`SF:${path}`, ...lines.map(([line, hits]) => `DA:${line},${hits}`)];
  if (fnf !== undefined) rows.push(`FNF:${fnf}`);
  if (fnh !== undefined) rows.push(`FNH:${fnh}`);
  if (lf !== undefined) rows.push(`LF:${lf}`);
  if (lh !== undefined) rows.push(`LH:${lh}`);
  rows.push("end_of_record");
  return rows.join("\n");
}

test("反斜杠路径统一成正斜杠，汇总字段原样读出", () => {
  const parsed = parseLcov(
    record("lib\\ansi.ts", {
      lines: [
        [1, 5],
        [2, 0],
      ],
      lf: 2,
      lh: 1,
      fnf: 3,
      fnh: 2,
    }),
  );

  assert.deepEqual(parsed.files, [
    {
      path: "lib/ansi.ts",
      linesFound: 2,
      linesHit: 1,
      functionsFound: 3,
      functionsHit: 2,
    },
  ]);
  assert.deepEqual(parsed.dropped, []);
  assert.equal(parsed.duplicates, 0);
});

test("同一路径带 ?mtime= 重复出现时按首次出现计", () => {
  const text = [
    record("lib\\a.ts?mtime=100", { lf: 10, lh: 4, fnf: 5, fnh: 1 }),
    record("lib\\a.ts?mtime=200", { lf: 99, lh: 99, fnf: 99, fnh: 99 }),
    "end_of_record",
  ].join("\n");

  const parsed = parseLcov(text);
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0].path, "lib/a.ts");
  assert.equal(parsed.files[0].linesFound, 10);
  assert.equal(parsed.files[0].linesHit, 4);
  assert.equal(parsed.files[0].functionsFound, 5);
  assert.equal(parsed.files[0].functionsHit, 1);
  assert.equal(parsed.duplicates, 1);
});

test("仓库外、绝对路径与越界记录整体丢弃", () => {
  const text = [
    record("..\\..\\..\\.omp\\agent\\extensions\\x\\index.ts?mtime=1", { lf: 8, lh: 3 }),
    record("C:\\Users\\someone\\editor.ts", { lf: 8, lh: 3 }),
    record("/home/someone/editor.ts", { lf: 8, lh: 3 }),
    record("lib/../../outside.ts", { lf: 8, lh: 3 }),
    record("lib/a.ts", { lf: 2, lh: 1 }),
  ].join("\n");

  const parsed = parseLcov(text);
  assert.deepEqual(
    parsed.files.map((file) => file.path),
    ["lib/a.ts"],
  );
  assert.equal(parsed.dropped.length, 4);
  assert.ok(parsed.dropped[0].startsWith(".."));
  assert.equal(aggregateCoverage(parsed.files).linesFound, 2);
});

test("缺字段时按 DA 推导行数，函数计数缺失记 0", () => {
  const text = [
    "SF:lib/missing.ts",
    "DA:1,0",
    "DA:2,3",
    "DA:not-a-number",
    "end_of_record",
    "SF:lib/tail.ts",
    "DA:7,1",
    "LH:9",
    "FNF:2",
    "end_of_record",
  ].join("\n");

  const parsed = parseLcov(text);
  const missing = parsed.files.find((file) => file.path === "lib/missing.ts");
  assert.deepEqual(missing, {
    path: "lib/missing.ts",
    linesFound: 2,
    linesHit: 1,
    functionsFound: 0,
    functionsHit: 0,
  });

  const tail = parsed.files.find((file) => file.path === "lib/tail.ts");
  assert.equal(tail.linesFound, 1);
  assert.equal(tail.linesHit, 1);
  assert.equal(tail.functionsFound, 2);
  assert.equal(tail.functionsHit, 0);
});

test("没有 SF 的记录被忽略", () => {
  const parsed = parseLcov(["DA:1,1", "LF:1", "LH:1", "end_of_record"].join("\n"));

  assert.deepEqual(parsed.files, []);
  assert.deepEqual(parsed.dropped, []);
});

test("Windows 与 Linux 写法的同一文件得到相同的指标", () => {
  const windows = parseLcov(record("lib\\a.ts", { lf: 10, lh: 7, fnf: 4, fnh: 3 }));
  const linux = parseLcov(record("lib/a.ts", { lf: 10, lh: 7, fnf: 4, fnh: 3 }));

  assert.deepEqual(windows.files, linux.files);
});

test("仓库内合计按加权求和，不用逐文件百分比的算术平均", () => {
  const totals = aggregateCoverage([
    { path: "lib/a.ts", linesFound: 100, linesHit: 1, functionsFound: 10, functionsHit: 1 },
    { path: "lib/b.ts", linesFound: 50, linesHit: 50, functionsFound: 10, functionsHit: 10 },
  ]);

  assert.deepEqual(totals, {
    linesFound: 150,
    linesHit: 51,
    functionsFound: 20,
    functionsHit: 11,
  });
});

test("indexByPath 按路径取指标", () => {
  const parsed = parseLcov(record("lib/a.ts", { lf: 2, lh: 1 }));
  const index = indexByPath(parsed.files);

  assert.equal(index.get("lib/a.ts")?.linesHit, 1);
  assert.equal(index.get("lib/b.ts"), undefined);
});
