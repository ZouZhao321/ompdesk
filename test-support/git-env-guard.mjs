import assert from "node:assert/strict";
import ts from "typescript";

/**
 * git 调用环境守卫的共享扫描。
 *
 * 用 TypeScript 的 AST 判定，不做字符配对：注释与字符串里的同名文本不会误算，参数里的
 * 括号也不会截断文本；正则扫源码则会把注释里出现的 `env: createGitEnv()` 也算进去，
 * 漏掉写在共享 options 变量里的那几处。
 */

/** 把 options 参数还原成对象字面量：直接写的字面量，或同文件的同名变量声明。 */
function resolveObjectLiteral(node, declarations) {
  if (ts.isObjectLiteralExpression(node)) return node;
  if (!ts.isIdentifier(node)) return null;
  const declaration = declarations.get(node.text);
  return declaration && ts.isObjectLiteralExpression(declaration.initializer)
    ? declaration.initializer
    : null;
}

/**
 * 取出源码里每个 `execFileAsync("git", ...)` 调用，解析出它的 options 对象。
 * `filename` 只用于解析上下文与报错定位。
 */
export function gitExecFileCalls(source, filename = "source.ts") {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = new Map();
  const collectDeclarations = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      declarations.set(node.name.text, node);
    }
    ts.forEachChild(node, collectDeclarations);
  };
  collectDeclarations(sourceFile);

  const calls = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "execFileAsync"
      && ts.isStringLiteral(node.arguments[0])
      && node.arguments[0].text === "git"
    ) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      calls.push({ line, options: resolveObjectLiteral(node.arguments[2], declarations) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

/** 对象字面量里是否有 `env: createGitEnv()` 属性。 */
export function hasCreateGitEnvProperty(objectLiteral) {
  return objectLiteral.properties.some((property) => {
    if (!ts.isPropertyAssignment(property)) return false;
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
      ? property.name.text
      : null;
    return name === "env"
      && ts.isCallExpression(property.initializer)
      && ts.isIdentifier(property.initializer.expression)
      && property.initializer.expression.text === "createGitEnv";
  });
}

/**
 * 断言每个 git 调用都显式传了剥离后的环境。`label` 指明出处，用在报错里；`calls`
 * 为空时由调用方自己断言调用数量，守卫不替它表态。
 */
export function assertStrippedGitEnv(calls, label) {
  for (const { line, options } of calls) {
    assert.ok(options, `${label} 第 ${line} 行的 git 调用必须传 options 对象字面量`);
    assert.ok(
      hasCreateGitEnvProperty(options),
      `${label} 第 ${line} 行的 git 调用要传剥离后的环境 env: createGitEnv()`,
    );
  }
}
