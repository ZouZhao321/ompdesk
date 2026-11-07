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
 */

import path from "node:path";
import ts from "typescript";

import { MODULE_SUFFIXES, parseSource } from "./source-scan";

/** 命名空间导入的通配标记：该模块的任意导出名都算被导入。 */
const ANY_IMPORTED_NAME = "*";

/** `./x` 相对导入的目标路径候选；包名与越出仓库根的路径返回 null。 */
function resolveSpecifier(fromFile: string, specifier: string): string[] | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  if (base.startsWith("..")) return null;
  return MODULE_SUFFIXES.map((suffix) => `${base}${suffix}`);
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

/**
 * 从测试文件源码建导入索引：被导入文件的路径 → 被导入的符号名集合。
 * 没有导入的文件不出现在结果里。
 */
export function collectTestImports(
  sources: ReadonlyMap<string, string>,
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();

  for (const [filePath, sourceText] of sources) {
    const sourceFile = parseSource(filePath, sourceText);

    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const names = importedNames(statement);
      if (names.length === 0) continue;
      const targets = resolveSpecifier(filePath, statement.moduleSpecifier.text);
      if (targets === null) continue;

      for (const target of targets) {
        const collected = index.get(target) ?? new Set<string>();
        for (const name of names) collected.add(name);
        index.set(target, collected);
      }
    }
  }

  return index;
}

/** 某个文件是否被测试文件导入了指定符号（命名空间导入视为全部导入）。 */
export function isImportedByTest(
  index: ReadonlyMap<string, ReadonlySet<string>>,
  file: string,
  name: string,
): boolean {
  const imported = index.get(file);
  if (!imported) return false;
  return imported.has(name) || imported.has(ANY_IMPORTED_NAME);
}
