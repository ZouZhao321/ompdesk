import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

/**
 * 读取真实的 useAgentSession.ts，并按名字取出 useCallback 回调与普通声明。
 *
 * 四个 hook 测试文件共用这一份脚手架：回调改名或换写法时只改这里，注入的 bindings
 * 仍由各测试文件自己组织。`callback` 把 ReferenceError 包一层，指明是哪个回调缺了
 * 哪个绑定，不必再从测试栈里反推。
 */
export const source = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");
export const ast = ts.createSourceFile("useAgentSession.ts", source, ts.ScriptTarget.Latest, true);
export const callbacks = new Map();
export const declarations = new Map();

function collect(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
    && node.initializer && ts.isCallExpression(node.initializer)
    && node.initializer.expression.getText(ast) === "useCallback") {
    callbacks.set(node.name.text, node.initializer.arguments[0].getText(ast));
  }
  if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
    declarations.set(node.name.text, node.getText(ast));
  }
  if (ts.isBinaryExpression(node) && node.left.getText(ast) === "runtimeIdRef.onIdentity") {
    callbacks.set("onIdentity", node.right.getText(ast));
  }
  ts.forEachChild(node, collect);
}
collect(ast);

export function callbackSource(name) {
  assert.ok(callbacks.has(name), `Missing callback: ${name}`);
  return callbacks.get(name);
}

export function callback(name, bindings) {
  const implementation = callbackSource(name);
  const { outputText } = ts.transpileModule(`const callback = ${implementation};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  });
  const fn = new Function(...Object.keys(bindings), `${outputText}\nreturn callback;`)(...Object.values(bindings));
  return (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      if (error instanceof ReferenceError) {
        throw new Error(`[${name}] unbound identifier: ${error.message}; add it to bindings`);
      }
      throw error;
    }
  };
}
