import assert from "node:assert/strict";
import test from "node:test";
import { collectExportUsage, baselineKey } from "../exports.ts";
import { ruleExports } from "./rule-exports.ts";

function symbol(name, kind = "runtime", declaration = "function") {
  return { name, kind, declaration };
}

function analysisOf({
  added = [],
  references = new Map(),
  baseline = new Set(),
  baselineError,
  readFailures = [],
} = {}) {
  return {
    added,
    references,
    baseline,
    scannedFiles: 0,
    readFailures,
    ...(baselineError === undefined ? {} : { baselineError }),
  };
}

function inputOf(exportUsage) {
  return {
    changedFiles: [],
    coverage: new Map(),
    totals: { linesFound: 0, linesHit: 0, functionsFound: 0, functionsHit: 0 },
    managedFiles: [],
    exportUsage,
  };
}

test("新增导出在生产源码里被引用时通过", () => {
  const findings = ruleExports.evaluate(
    inputOf(
      analysisOf({
        added: [{ file: "lib/math.ts", symbol: symbol("add") }],
        references: new Map([["lib/math.ts", new Map([["add", ["lib/use.ts"]]])]]),
      }),
    ),
  );

  assert.deepEqual(findings, []);
});

test("新增导出只被测试文件引用时失败，输出符号名与所在文件", async () => {
  const read = [];
  const workspace = {
    "lib/only-tests.ts": "export function onlyForTests() {\n  return 1;\n}",
    "lib/only-tests.test.mjs": 'import { onlyForTests } from "./only-tests.ts";\nonlyForTests();',
  };
  const analysis = await collectExportUsage({
    changedFiles: [{ path: "lib/only-tests.ts", status: "added" }],
    managedFiles: ["lib/only-tests.ts"],
    readers: {
      readWorkspace: async (filePath) => {
        read.push(filePath);
        return workspace[filePath];
      },
      readAtMergeBase: async () => null,
    },
    baselineText: null,
  });

  const findings = ruleExports.evaluate(inputOf(analysis));

  assert.deepEqual(read, ["lib/only-tests.ts"]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "rule-3");
  assert.equal(findings[0].file, "lib/only-tests.ts");
  assert.match(findings[0].numbers, /onlyForTests（运行时导出）生产引用 0/);
  assert.match(findings[0].reason, /onlyForTests/);
});

test("框架按文件名或路径调用的导出不判失败", () => {
  const findings = ruleExports.evaluate(
    inputOf(
      analysisOf({
        added: [
          { file: "app/api/thing/route.ts", symbol: symbol("GET", "runtime", "variable") },
          { file: "app/api/thing/route.ts", symbol: symbol("POST", "runtime", "variable") },
          { file: "app/api/thing/route.ts", symbol: symbol("dynamic", "runtime", "variable") },
          { file: "app/page.tsx", symbol: symbol("default", "runtime", "default") },
          { file: "app/layout.tsx", symbol: symbol("default", "runtime", "default") },
          { file: "app/layout.tsx", symbol: symbol("metadata", "runtime", "variable") },
          { file: "app/layout.tsx", symbol: symbol("viewport", "runtime", "variable") },
          { file: "app/manifest.ts", symbol: symbol("default", "runtime", "default") },
          { file: "next.config.ts", symbol: symbol("default", "runtime", "default") },
          { file: "tailwind.config.ts", symbol: symbol("default", "runtime", "default") },
          { file: "postcss.config.mjs", symbol: symbol("default", "runtime", "default") },
          { file: "eslint.config.mjs", symbol: symbol("default", "runtime", "default") },
          { file: "proxy.ts", symbol: symbol("proxy", "runtime", "function") },
          { file: "bin/ompdesk.js", symbol: symbol("parseArgs") },
          { file: "instrumentation.ts", symbol: symbol("register") },
        ],
      }),
    ),
  );

  assert.deepEqual(findings, []);
});

test("路由文件里的普通导出仍然参与判定", () => {
  const findings = ruleExports.evaluate(
    inputOf(
      analysisOf({
        added: [{ file: "app/api/thing/route.ts", symbol: symbol("formatBody") }],
      }),
    ),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, "app/api/thing/route.ts");
});

test("基线里的存量符号不判失败，新增符号仍被判失败", () => {
  const findings = ruleExports.evaluate(
    inputOf(
      analysisOf({
        added: [
          { file: "lib/legacy.ts", symbol: symbol("legacyHelper") },
          { file: "lib/legacy.ts", symbol: symbol("freshHelper") },
        ],
        baseline: new Set([baselineKey("lib/legacy.ts", "legacyHelper", "runtime")]),
      }),
    ),
  );

  assert.equal(findings.length, 1);
  assert.match(findings[0].numbers, /freshHelper/);
});

test("仅类型导出与运行时导出分别统计", () => {
  const findings = ruleExports.evaluate(
    inputOf(
      analysisOf({
        added: [
          { file: "lib/mixed.ts", symbol: symbol("alpha") },
          { file: "lib/mixed.ts", symbol: symbol("beta", "runtime", "variable") },
          { file: "lib/mixed.ts", symbol: symbol("Gamma", "type", "type") },
        ],
      }),
    ),
  );

  assert.equal(findings.length, 3);
  for (const finding of findings) {
    assert.match(finding.numbers, /新增运行时导出 2 个、仅类型导出 1 个/);
  }
  assert.match(findings[0].numbers, /alpha（运行时导出）/);
  assert.match(findings[2].numbers, /Gamma（仅类型导出）/);
});

test("基线文件解析失败时报成失败并指明原因", () => {
  const findings = ruleExports.evaluate(inputOf(analysisOf({ baselineError: "基线文件缺少 symbols 数组" })));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, "coverage-export-baseline.json");
  assert.match(findings[0].reason, /基线文件缺少 symbols 数组/);
});

test("引用索引读不全时报一条流水线问题，不做逐符号判定", () => {
  const findings = ruleExports.evaluate(
    inputOf(
      analysisOf({
        added: [{ file: "lib/math.ts", symbol: symbol("add") }],
        readFailures: ["lib/broken.ts：EACCES: permission denied"],
      }),
    ),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, "（受管源文件）");
  assert.match(findings[0].numbers, /读取失败 1 个文件/);
  assert.match(findings[0].reason, /lib\/broken\.ts/);
  assert.match(findings[0].fix, /可读/);
});
