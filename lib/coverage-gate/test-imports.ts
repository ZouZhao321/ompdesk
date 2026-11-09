/**
 * 测试文件的导入语句索引。
 *
 * 被动覆盖的静态检查只回答一件事：新增的对外函数名有没有被测试文件写进导入语句。
 * 文本搜索会把注释、字符串和同名变量都算进去，这里用 TypeScript 编译器接口解析语法树，
 * 只认 `import` 声明里的具名导入。
 *
 * 索引的键是被导入文件的仓库内路径：`lib/a.ts` 里 `import { f } from "./b"` 记到
 * `lib/b.ts` 名下。相对路径按扩展名候选逐个登记——这里拿不到完整文件清单，多登记几个
 * 不存在的键没有副作用，查找只发生在真实路径上。
 *
 * `import * as ns` 不写出符号名，测试仍可能通过 `ns.f` 调用，按「该模块的全部导出都被
 * 导入」记成通配标记，避免误报。
 *
 * 仓库里的测试大量用 `const { f } = await import("./x.ts")` 这类动态导入拿符号，静态
 * `import` 声明不是唯一写法：动态导入按解构出的名字登记；拿到的是命名空间对象时同样
 * 记成通配标记；只做副作用加载（不绑定任何名字）不计入。
 */

import path from "node:path";
import ts from "typescript";

/** 命名空间导入的通配标记：该模块的任意导出名都算被导入。 */
const ANY_IMPORTED_NAME = "*";

const IMPORT_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
];

function scriptKindOf(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.(mjs|cjs|js)$/.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** `./x` 相对导入的目标路径候选；包名与越出仓库根的路径返回 null。 */
function resolveSpecifier(fromFile: string, specifier: string): string[] | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  if (base.startsWith("..")) return null;
  return IMPORT_SUFFIXES.map((suffix) => `${base}${suffix}`);
}

/** 一个 `import` 声明贡献的名字；命名空间导入贡献通配标记。 */
function importedNames(declaration: ts.ImportDeclaration): string[] {
  const clause = declaration.importClause;
  // 纯类型导入不执行被导入模块，不能当作被动覆盖。
  if (!clause || clause.isTypeOnly) return [];

  const names: string[] = [];
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      // 别名导入 `{ foo as bar }` 里，被导入的符号名是 `foo`。
      names.push((element.propertyName ?? element.name).text);
    }
  } else if (bindings && ts.isNamespaceImport(bindings)) {
    names.push(ANY_IMPORTED_NAME);
  }
  return names;
}

/** 动态导入（`import("…")` 与 `jiti.import("…")`）的目标模块；其它调用返回 null。 */
function dynamicImportSpecifier(node: ts.CallExpression): string | null {
  const callee = node.expression;
  const isImportKeyword = callee.kind === ts.SyntaxKind.ImportKeyword;
  const isImportMethod = ts.isPropertyAccessExpression(callee) && callee.name.text === "import";
  if (!isImportKeyword && !isImportMethod) return null;

  const [argument] = node.arguments;
  if (argument === undefined) return null;
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) return argument.text;
  return null;
}

/**
 * 动态导入贡献的名字。`const { f } = await import("…")` 取解构出的名字；
 * `const mod = await import("…")` 拿到命名空间对象，记成通配标记；
 * 只做副作用加载时不贡献名字。
 */
function dynamicImportNames(node: ts.CallExpression): string[] {
  const awaited = node.parent !== undefined && ts.isAwaitExpression(node.parent) ? node.parent : node;
  const parent = awaited.parent;
  if (parent === undefined || !ts.isVariableDeclaration(parent)) return [];

  // `const mod = await import("…")` 拿到命名空间对象，测试可用任意导出。
  if (ts.isIdentifier(parent.name)) return [ANY_IMPORTED_NAME];
  if (!ts.isObjectBindingPattern(parent.name)) return [];

  return parent.name.elements.flatMap((element) => {
    if (element.dotDotDotToken !== undefined) return [ANY_IMPORTED_NAME];
    const name = element.propertyName ?? element.name;
    // `{ foo: bar }` 里被导入的符号名是 `foo`；计算属性名静态读不出。
    return ts.isIdentifier(name) ? [name.text] : [];
  });
}

function addImported(
  index: Map<string, Set<string>>,
  fromFile: string,
  specifier: string,
  names: readonly string[],
): void {
  if (names.length === 0) return;
  const targets = resolveSpecifier(fromFile, specifier);
  if (targets === null) return;

  for (const target of targets) {
    const collected = index.get(target) ?? new Set<string>();
    for (const name of names) collected.add(name);
    index.set(target, collected);
  }
}

/**
 * 从测试文件源码建导入索引：被导入文件的路径 → 被导入的符号名集合。
 * 没有导入的文件不出现在结果里。
 */
export function collectTestImports(sources: ReadonlyMap<string, string>): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();

  for (const [filePath, sourceText] of sources) {
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      scriptKindOf(filePath),
    );

    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
      addImported(index, filePath, statement.moduleSpecifier.text, importedNames(statement));
    }

    // 动态导入可以出现在任意层级（测试回调里也会用），整棵树遍历。
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const specifier = dynamicImportSpecifier(node);
        if (specifier !== null) addImported(index, filePath, specifier, dynamicImportNames(node));
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return index;
}

/** 某个文件是否被测试文件导入了指定符号（命名空间导入视为全部导入）。 */
export function isImportedByTest(index: ReadonlyMap<string, ReadonlySet<string>>, file: string, name: string): boolean {
  const imported = index.get(file);
  if (!imported) return false;
  return imported.has(name) || imported.has(ANY_IMPORTED_NAME);
}
