import assert from "node:assert/strict";
import test from "node:test";
import { applyExceptions, localTodayIso, resolveExceptions } from "./exceptions.ts";

const TODAY = "2026-11-06";

function textOf(entries) {
  return JSON.stringify({ exceptions: entries });
}

function validEntry(overrides = {}) {
  return {
    file: "lib/legacy/theme.ts",
    rule: "rule-1",
    reason: "只做类型声明，测试运行时不会加载",
    verification: "bun run typecheck 覆盖该文件的类型错误",
    expiresOn: "2026-12-31",
    ...overrides,
  };
}

function finding(overrides = {}) {
  return {
    rule: "rule-1",
    file: "lib/legacy/theme.ts",
    numbers: "产物记录 0 条（函数 0/0）",
    reason: "文件未被任何测试加载",
    fix: "补一个会 import 该文件的测试",
    ...overrides,
  };
}

test("五字段完整且未到期时进入生效清单", () => {
  const resolution = resolveExceptions(textOf([validEntry()]), TODAY);

  assert.equal(resolution.present, true);
  assert.deepEqual(resolution.problems, []);
  assert.equal(resolution.expired.length, 0);
  assert.equal(resolution.active.length, 1);
  assert.deepEqual(
    {
      file: resolution.active[0].file,
      rule: resolution.active[0].rule,
      reason: resolution.active[0].reason,
      verification: resolution.active[0].verification,
      expiresOn: resolution.active[0].expiresOn,
    },
    validEntry(),
  );
  assert.deepEqual(resolution.active[0].suppressed, []);
});

test("缺任一字段都记一条问题并跳过该条", () => {
  for (const field of ["file", "rule", "reason", "verification", "expiresOn"]) {
    const resolution = resolveExceptions(textOf([validEntry({ [field]: undefined })]), TODAY);

    assert.equal(resolution.active.length, 0, `缺少 ${field} 时不应生效`);
    assert.equal(resolution.expired.length, 0);
    assert.equal(resolution.problems.length, 1, `缺少 ${field} 应记一条问题`);
    assert.match(resolution.problems[0].message, new RegExp(`缺少字段 ${field}`));
  }
});

test("理由为空字符串时失败", () => {
  const resolution = resolveExceptions(textOf([validEntry({ reason: "   " })]), TODAY);

  assert.equal(resolution.active.length, 0);
  assert.equal(resolution.problems.length, 1);
  assert.match(resolution.problems[0].message, /reason（理由）是空字符串/);
});

test("同一文件同一规则重复登记时失败，首条保留", () => {
  const resolution = resolveExceptions(
    textOf([
      validEntry(),
      validEntry({ reason: "换个理由再登记一次", expiresOn: "2027-01-31" }),
    ]),
    TODAY,
  );

  assert.equal(resolution.active.length, 1);
  assert.equal(resolution.active[0].expiresOn, "2026-12-31");
  assert.equal(resolution.problems.length, 1);
  assert.match(resolution.problems[0].message, /第 2 条与第 1 条重复登记 lib\/legacy\/theme\.ts 的 rule-1/);
});

test("到期日当天仍然生效，次日起失效", () => {
  const entry = validEntry({ expiresOn: "2026-11-06" });

  const onExpiryDay = resolveExceptions(textOf([entry]), "2026-11-06");
  assert.equal(onExpiryDay.active.length, 1);
  assert.equal(onExpiryDay.expired.length, 0);

  const dayAfter = resolveExceptions(textOf([entry]), "2026-11-07");
  assert.equal(dayAfter.active.length, 0);
  assert.equal(dayAfter.expired.length, 1);
  assert.equal(dayAfter.expired[0].file, "lib/legacy/theme.ts");
});

test("到期日不是真实日期时失败", () => {
  for (const expiresOn of ["2026-02-30", "2026-13-01", "2026/12/31", "2026-12"]) {
    const resolution = resolveExceptions(textOf([validEntry({ expiresOn })]), TODAY);

    assert.equal(resolution.active.length, 0, `${expiresOn} 不应生效`);
    assert.equal(resolution.problems.length, 1);
    assert.match(resolution.problems[0].message, /到期日.*不合法/);
  }
});

test("规则编号不存在时失败", () => {
  const resolution = resolveExceptions(textOf([validEntry({ rule: "rule-9" })]), TODAY);

  assert.equal(resolution.active.length, 0);
  assert.equal(resolution.problems.length, 1);
  assert.match(resolution.problems[0].message, /rule-9 不存在/);
  assert.match(resolution.problems[0].message, /rule-1、rule-2、rule-3/);
});

test("清单不可解析或结构不对时记一条整体问题", () => {
  const broken = resolveExceptions("{", TODAY);
  assert.equal(broken.problems.length, 1);
  assert.equal(broken.problems[0].index, 0);
  assert.match(broken.problems[0].message, /不是合法 JSON/);

  const notObject = resolveExceptions("[]", TODAY);
  assert.match(notObject.problems[0].message, /顶层必须是对象/);

  const missingArray = resolveExceptions("{}", TODAY);
  assert.match(missingArray.problems[0].message, /缺少 exceptions 数组/);
});

test("清单文件不存在时按没有登记处理", () => {
  const resolution = resolveExceptions(null, TODAY);

  assert.equal(resolution.present, false);
  assert.equal(resolution.active.length, 0);
  assert.equal(resolution.expired.length, 0);
  assert.deepEqual(resolution.problems, []);
});

test("生效豁免只放行登记的文件与规则", () => {
  const resolution = resolveExceptions(textOf([validEntry()]), TODAY);
  const findings = [
    finding(),
    finding({ rule: "rule-2", numbers: "改动前 3/4，改动后 3/4" }),
    finding({ file: "lib/legacy/other.ts" }),
  ];

  const applied = applyExceptions(findings, resolution);

  assert.deepEqual(
    applied.blocking.map((item) => `${item.rule} ${item.file}`),
    ["rule-2 lib/legacy/theme.ts", "rule-1 lib/legacy/other.ts"],
  );
  assert.equal(applied.exceptions.active.length, 1);
  assert.deepEqual(
    applied.exceptions.active[0].suppressed.map((item) => item.file),
    ["lib/legacy/theme.ts"],
  );
  assert.equal(applied.exceptions.problems.length, 0);
});

test("已到期的条目不放行任何判定", () => {
  const resolution = resolveExceptions(textOf([validEntry({ expiresOn: "2026-10-01" })]), TODAY);
  const applied = applyExceptions([finding()], resolution);

  assert.equal(applied.blocking.length, 1);
  assert.equal(applied.exceptions.active.length, 0);
  assert.equal(applied.exceptions.expired.length, 1);
});

test("清单里的反斜杠路径与判定里的正斜杠路径配对", () => {
  const resolution = resolveExceptions(
    textOf([validEntry({ file: "lib\\legacy\\theme.ts" })]),
    TODAY,
  );

  assert.equal(resolution.active[0].file, "lib/legacy/theme.ts");
  assert.equal(applyExceptions([finding()], resolution).blocking.length, 0);
});

test("清单路径必须是相对仓库根的路径", () => {
  const resolution = resolveExceptions(textOf([validEntry({ file: "C:/repo/lib/a.ts" })]), TODAY);

  assert.equal(resolution.active.length, 0);
  assert.match(resolution.problems[0].message, /必须是相对仓库根的路径/);
});

test("默认复核日期取本地日历日期", () => {
  assert.equal(localTodayIso(new Date(2026, 11, 31, 23, 30)), "2026-12-31");
  assert.equal(localTodayIso(new Date(2027, 0, 1, 0, 5)), "2027-01-01");
});
