import assert from "node:assert/strict";
import test from "node:test";
import { collectFunctionSurface, collectNamedFunctionExports, diffFunctionSurface } from "./function-names.ts";

function surface(source) {
  return collectFunctionSurface(source, "lib/sample.ts");
}

function defined(source) {
  return [...surface(source).defined].sort();
}

test("函数声明、箭头函数与方法简写都进定义集合", () => {
  const source = [
    "export function render() {}",
    "const format = (value: number) => String(value);",
    "const api = { read() {}, write: () => {} };",
    "class Store { load() {} }",
  ].join("\n");

  assert.deepEqual(defined(source), ["format", "load", "read", "render", "write"]);
});

test("匿名默认导出按 default 记，函数表达式取变量名", () => {
  const source = [
    "export default function () {}",
    "export const handler = function () {};",
  ].join("\n");

  assert.deepEqual(defined(source), ["default", "handler"]);
});

test("重导出单独统计，不算进定义集合", () => {
  const result = surface('export { helper as run, load } from "./helper";');

  assert.deepEqual([...result.defined], []);
  assert.deepEqual([...result.reExported].sort(), ["load", "run"]);
});

test("同名函数只算一个，注释与字符串里的写法不算", () => {
  const source = [
    "// render() 写在注释里",
    'const label = "function fake() {}";',
    "export function render() {}",
    "export function render() {}",
  ].join("\n");

  assert.deepEqual(defined(source), ["render"]);
});

test("差集区分新增与删除", () => {
  const base = surface("function keep() {}\nfunction gone() {}");
  const head = surface("function keep() {}\nfunction fresh() {}");

  const diff = diffFunctionSurface(base, head);

  assert.deepEqual(diff.added, ["fresh"]);
  assert.deepEqual(diff.removed, ["gone"]);
});

test("重导出新增单独返回，不混进新增函数", () => {
  const base = surface("function keep() {}");
  const head = surface('function keep() {}\nexport { keep as forward } from "./x";');

  const diff = diffFunctionSurface(base, head);

  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.addedReExports, ["forward"]);
});

test("重导出删除单独返回", () => {
  const base = surface('export { load } from "./loader";');
  const head = surface("function keep() {}");

  const diff = diffFunctionSurface(base, head);

  assert.deepEqual(diff.removedReExports, ["load"]);
  assert.deepEqual(diff.addedReExports, []);
});

test("导出名映射到本文件函数名，默认导出不收", () => {
  const source = [
    "export function render() {}",
    "export const format = (value: number) => String(value);",
    "export default function () {}",
    "function inner() {}",
  ].join("\n");

  assert.deepEqual({ ...collectNamedFunctionExports(source, "lib/sample.ts") }, {
    format: "format",
    render: "render",
  });
});
