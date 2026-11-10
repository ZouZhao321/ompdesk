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

import { parseSource } from "./source-scan";

interface FunctionSurface {
  /** 本文件定义的函数名。 */
  defined: Set<string>;
  /** 重导出的名字，含 `export * as ns` 的命名空间名。 */
  reExported: Set<string>;
}

interface FunctionSurfaceDiff {
  added: string[];
  removed: string[];
  addedReExports: string[];
  removedReExports: string[];
}

/** 属性名或变量名；计算属性没有稳定的名字，返回 null 交给调用方跳过。 */
function nameText(name: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function isFunctionLikeValue(node: ts.Node | undefined): boolean {
  return node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
}

/**
 * 收集文件里的函数名。覆盖函数声明、赋给变量的箭头函数与函数表达式、对象方法与类方法
 * 的简写、访问器、类字段上的箭头函数，以及重导出。
 */
export function collectFunctionSurface(sourceText: string, fileName: string): FunctionSurface {
  const sourceFile = parseSource(fileName, sourceText);
  const surface: FunctionSurface = { defined: new Set(), reExported: new Set() };

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node)) {
      // 匿名函数声明只可能是 `export default function () {}`。
      surface.defined.add(nameText(node.name) ?? "default");
    } else if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
      const name = nameText(node.name);
      if (name !== null) surface.defined.add(name);
    } else if (
      (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
      isFunctionLikeValue(node.initializer)
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

function hasPlainExportModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (!modifiers) return false;
  const kinds = modifiers.map((modifier) => modifier.kind);
  return kinds.includes(ts.SyntaxKind.ExportKeyword) && !kinds.includes(ts.SyntaxKind.DefaultKeyword);
}

/**
 * 本文件对外暴露的函数名：导出名 → 本文件里的函数名。别名导出按导出名记，
 * `export { foo as bar }` 得到 `bar → foo`。
 *
 * 默认导出没有可对照的符号名（`import x from` 不写出符号），不参与被动覆盖检查，
 * 这里不收录。
 */
export function collectNamedFunctionExports(sourceText: string, fileName: string): Record<string, string> {
  const sourceFile = parseSource(fileName, sourceText);
  const defined = collectFunctionSurface(sourceText, fileName).defined;
  // 导出名来自源码，`constructor`、`__proto__` 这类名字会撞上原型链，用无原型对象。
  const exported: Record<string, string> = Object.create(null);

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && hasPlainExportModifier(node)) {
      exported[node.name.text] = node.name.text;
    } else if (ts.isVariableStatement(node) && hasPlainExportModifier(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!isFunctionLikeValue(declaration.initializer)) continue;
        const name = nameText(declaration.name);
        if (name !== null) exported[name] = name;
      }
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier === undefined &&
      node.exportClause !== undefined &&
      ts.isNamedExports(node.exportClause)
    ) {
      for (const element of node.exportClause.elements) {
        const local = (element.propertyName ?? element.name).text;
        if (defined.has(local)) exported[element.name.text] = local;
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return exported;
}

/** 名字集合的差集，按名称排序，输出稳定。 */
export function diffFunctionSurface(base: FunctionSurface, head: FunctionSurface): FunctionSurfaceDiff {
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
