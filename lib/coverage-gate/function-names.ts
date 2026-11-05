/**
 * 函数名集合提取。
 *
 * 规则二比较两版文件的函数结构，靠的是函数名集合的差集，不是文本搜索：文本搜索会把
 * 注释与字符串里的同名写法算进去，也认不出对象方法的简写。这里用 TypeScript 编译器
 * 接口解析语法树，同一个名字在文件里出现多次只算一个。
 *
 * 名字分两类：
 *
 * - `defined`：本文件里带函数体的定义，会出现在 lcov 的 FNF 里；
 * - `reExported`：`export { a } from "./x"` 这类重导出，只有对外的名字，没有函数体，
 *   不算进 FNF。
 *
 * 两类分开统计，避免只加一行重导出就被读成"新增函数没有被调用"。
 */

import ts from "typescript";

export interface FunctionSurface {
  /** 本文件定义的函数名。 */
  defined: Set<string>;
  /** 重导出的名字，含 `export * as ns` 的命名空间名。 */
  reExported: Set<string>;
}

export interface FunctionSurfaceDiff {
  added: string[];
  removed: string[];
  addedReExports: string[];
  removedReExports: string[];
}

function scriptKindOf(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.(mjs|cjs|js)$/.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** 属性名或变量名；计算属性没有稳定的名字，返回 null 交给调用方跳过。 */
function nameText(name: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function isFunctionLikeValue(node: ts.Node | undefined): boolean {
  return (
    node !== undefined
    && (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
  );
}

/**
 * 收集文件里的函数名。覆盖函数声明、赋给变量的箭头函数与函数表达式、对象方法与类方法
 * 的简写、访问器、类字段上的箭头函数，以及重导出。
 */
export function collectFunctionSurface(
  sourceText: string,
  fileName: string,
): FunctionSurface {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKindOf(fileName),
  );
  const surface: FunctionSurface = { defined: new Set(), reExported: new Set() };

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node)) {
      // 匿名函数声明只可能是 `export default function () {}`。
      surface.defined.add(nameText(node.name) ?? "default");
    } else if (
      ts.isMethodDeclaration(node)
      || ts.isGetAccessorDeclaration(node)
      || ts.isSetAccessorDeclaration(node)
    ) {
      const name = nameText(node.name);
      if (name !== null) surface.defined.add(name);
    } else if (
      (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node))
      && isFunctionLikeValue(node.initializer)
    ) {
      const name = nameText(node.name);
      if (name !== null) surface.defined.add(name);
    } else if (ts.isPropertyAssignment(node) && isFunctionLikeValue(node.initializer)) {
      const name = nameText(node.name);
      if (name !== null) surface.defined.add(name);
    } else if (ts.isExportAssignment(node) && isFunctionLikeValue(node.expression)) {
      // `export default () => {}`：没有名字，按 `default` 记。
      surface.defined.add("default");
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const clause = node.exportClause;
      if (clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          surface.reExported.add(element.name.text);
        }
      } else if (clause && ts.isNamespaceExport(clause)) {
        surface.reExported.add(clause.name.text);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return surface;
}

/** 名字集合的差集，按名称排序，输出稳定。 */
export function diffFunctionSurface(
  base: FunctionSurface,
  head: FunctionSurface,
): FunctionSurfaceDiff {
  const added = [...head.defined].filter((name) => !base.defined.has(name)).sort();
  const removed = [...base.defined].filter((name) => !head.defined.has(name)).sort();
  const addedReExports = [...head.reExported]
    .filter((name) => !base.reExported.has(name) && !head.defined.has(name))
    .sort();
  const removedReExports = [...base.reExported]
    .filter((name) => !head.reExported.has(name) && !base.defined.has(name))
    .sort();
  return { added, removed, addedReExports, removedReExports };
}
