import ts from "typescript";

import type { ChangedFile } from "./git";

/**
 * 导出符号的结构提取与引用索引。
 *
 * 语法树来自仓库已有的 TypeScript 编译器接口，不引新依赖，也不靠文本搜索统计引用：
 * 文本搜索会把注释、字符串与同名局部变量算成引用。本模块只做纯计算，读文件由调用方
 * 注入，测试用固定样本。
 */

/** 导出种类。仅类型导出会在编译后消失，与运行时导出分开统计。 */
export type ExportKind = "type" | "runtime";

/** 声明形式，只用于输出，让作者知道该改哪一行。 */
export type ExportDeclaration =
  | "function"
  | "class"
  | "variable"
  | "enum"
  | "namespace"
  | "type"
  | "interface"
  | "default"
  | "alias"
  | "re-export";

export interface ExportedSymbol {
  /** 导出名；默认导出记作 `default`。 */
  name: string;
  kind: ExportKind;
  declaration: ExportDeclaration;
}

/** 本文件对其他模块的引用，`named` 里放的是被引用模块的导出名。 */
interface ModuleImport {
  specifier: string;
  named: readonly string[];
  defaultRef: boolean;
  /** `import * as ns` 与 `export * from`：视为引用目标模块的全部导出。 */
  namespaceRef: boolean;
}

/** 具名转出口。引用方导入的是转出后的名字，定义处才是要记录的模块。 */
interface ReExport {
  specifier: string;
  name: string;
}

interface ModuleScan {
  exports: ExportedSymbol[];
  imports: ModuleImport[];
  reExports: ReExport[];
  /** `export * from` 的目标；仓库当前没有这种写法，索引仍按其语义处理。 */
  stars: string[];
}

/** 目标文件 → 导出名 → 引用方文件。`*` 表示「引用了该模块的全部导出」。 */
type ReferenceIndex = ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;

const ALL_EXPORTS = "*";

/** 新增导出：相对分叉点版本新出现的符号。 */
interface AddedExport {
  file: string;
  symbol: ExportedSymbol;
}

export interface ExportAnalysis {
  added: readonly AddedExport[];
  references: ReferenceIndex;
  /** 基线里的存量条目，键由 `baselineKey` 生成。 */
  baseline: ReadonlySet<string>;
  /** 引用索引覆盖的受管源文件数。 */
  scannedFiles: number;
  /** 基线文件存在但无法解析时的说明；有值时规则把它报成失败。 */
  baselineError?: string;
}

/** 基线条目的值。 */
interface BaselineEntry {
  path: string;
  name: string;
  kind: ExportKind;
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const RESOLVE_SUFFIXES = ["", ...SOURCE_EXTENSIONS, "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

const SCRIPT_KIND_BY_EXTENSION: Record<string, ts.ScriptKind> = {
  ts: ts.ScriptKind.TS,
  tsx: ts.ScriptKind.TSX,
  js: ts.ScriptKind.JS,
  jsx: ts.ScriptKind.JSX,
  mjs: ts.ScriptKind.JS,
  cjs: ts.ScriptKind.JS,
};

function scriptKindOf(filePath: string): ts.ScriptKind {
  const extension = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
  return SCRIPT_KIND_BY_EXTENSION[extension] ?? ts.ScriptKind.TS;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  const names: string[] = [];
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) names.push(...bindingNames(element.name));
  }
  return names;
}

/**
 * 本文件顶层名字是仅类型还是运行时。`export { name }` 不带 `type` 修饰符时靠这张表
 * 区分，否则重命名导出会把类型当成运行时导出。
 */
function collectLocalKinds(source: ts.SourceFile): Map<string, ExportKind> {
  const kinds = new Map<string, ExportKind>();

  const mark = (name: string, kind: ExportKind) => kinds.set(name, kind);

  for (const statement of source.statements) {
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
      mark(statement.name.text, "type");
      continue;
    }
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) {
      if (statement.name) mark(statement.name.text, "runtime");
      continue;
    }
    if (ts.isModuleDeclaration(statement)) {
      if (ts.isIdentifier(statement.name)) mark(statement.name.text, "runtime");
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(declaration.name)) mark(name, "runtime");
      }
      continue;
    }
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (!clause) continue;
      if (clause.name) mark(clause.name.text, clause.isTypeOnly ? "type" : "runtime");
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        mark(bindings.name.text, clause.isTypeOnly ? "type" : "runtime");
      }
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          mark(element.name.text, clause.isTypeOnly || element.isTypeOnly ? "type" : "runtime");
        }
      }
    }
  }

  return kinds;
}

function collectExports(source: ts.SourceFile, localKinds: ReadonlyMap<string, ExportKind>): ExportedSymbol[] {
  const exported: ExportedSymbol[] = [];
  const push = (name: string, kind: ExportKind, declaration: ExportDeclaration) => {
    exported.push({ name, kind, declaration });
  };

  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : null;
      const clause = statement.exportClause;
      // `export * from` 的导出名无法静态得知，引用索引按「引用全部」处理。
      if (!clause) continue;
      if (ts.isNamespaceExport(clause)) {
        push(clause.name.text, "runtime", "namespace");
        continue;
      }
      for (const element of clause.elements) {
        const localName = element.propertyName && ts.isIdentifier(element.propertyName)
          ? element.propertyName.text
          : element.name.text;
        const typeOnly = statement.isTypeOnly || element.isTypeOnly;
        const kind: ExportKind = typeOnly
          ? "type"
          : specifier
            ? "runtime"
            : localKinds.get(localName) ?? "runtime";
        push(element.name.text, kind, specifier ? "re-export" : "alias");
      }
      continue;
    }

    if (ts.isExportAssignment(statement)) {
      if (!statement.isExportEquals) push("default", "runtime", "default");
      continue;
    }

    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;

    if (ts.isFunctionDeclaration(statement)) {
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) push("default", "runtime", "default");
      else if (statement.name) push(statement.name.text, "runtime", "function");
      continue;
    }
    if (ts.isClassDeclaration(statement)) {
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) push("default", "runtime", "default");
      else if (statement.name) push(statement.name.text, "runtime", "class");
      continue;
    }
    if (ts.isInterfaceDeclaration(statement)) {
      push(statement.name.text, "type", "interface");
      continue;
    }
    if (ts.isTypeAliasDeclaration(statement)) {
      push(statement.name.text, "type", "type");
      continue;
    }
    if (ts.isEnumDeclaration(statement)) {
      push(statement.name.text, "runtime", "enum");
      continue;
    }
    if (ts.isModuleDeclaration(statement)) {
      if (ts.isIdentifier(statement.name)) push(statement.name.text, "runtime", "namespace");
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(declaration.name)) push(name, "runtime", "variable");
      }
    }
  }

  return exported;
}

function collectImports(source: ts.SourceFile): { imports: ModuleImport[]; reExports: ReExport[]; stars: string[] } {
  const imports: ModuleImport[] = [];
  const reExports: ReExport[] = [];
  const stars: string[] = [];

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (!clause) {
        imports.push({ specifier, named: [], defaultRef: false, namespaceRef: false });
        continue;
      }
      const named: string[] = [];
      let namespaceRef = false;
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) namespaceRef = true;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          named.push(element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : element.name.text);
        }
      }
      imports.push({ specifier, named, defaultRef: clause.name !== undefined, namespaceRef });
      continue;
    }

    if (!ts.isExportDeclaration(statement)) continue;
    if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.exportClause;
    if (!clause) {
      stars.push(specifier);
      imports.push({ specifier, named: [], defaultRef: false, namespaceRef: true });
      continue;
    }
    if (ts.isNamespaceExport(clause)) {
      imports.push({ specifier, named: [], defaultRef: false, namespaceRef: true });
      continue;
    }
    const named: string[] = [];
    for (const element of clause.elements) {
      const name = element.propertyName && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : element.name.text;
      named.push(name);
      reExports.push({ specifier, name });
    }
    imports.push({ specifier, named, defaultRef: false, namespaceRef: false });
  }

  return { imports, reExports, stars };
}

/** 扫描一个文件：导出、对外引用、转出口。 */
function scanModule(filePath: string, sourceText: string): ModuleScan {
  const source = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    false,
    scriptKindOf(filePath),
  );
  const localKinds = collectLocalKinds(source);
  const { imports, reExports, stars } = collectImports(source);
  return { exports: collectExports(source, localKinds), imports, reExports, stars };
}

/** 只取导出符号。 */
export function extractExports(filePath: string, sourceText: string): ExportedSymbol[] {
  return scanModule(filePath, sourceText).exports;
}

function normalizeSegments(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

/**
 * 把导入写法解析成仓库内路径。只认相对路径与 `@/` 别名，包名一律不解析：外部依赖
 * 不参与本仓库的导出引用统计。
 */
function resolveModule(fromFile: string, specifier: string, files: ReadonlySet<string>): string | null {
  const cleaned = specifier.split(/[?#]/)[0];
  let basePath: string | null;
  if (cleaned.startsWith("./") || cleaned.startsWith("../")) {
    const directory = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
    basePath = normalizeSegments(`${directory}/${cleaned}`);
  } else if (cleaned.startsWith("@/")) {
    basePath = normalizeSegments(cleaned.slice(2));
  } else {
    return null;
  }
  if (!basePath) return null;
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = `${basePath}${suffix}`;
    if (files.has(candidate)) return candidate;
  }
  return null;
}

/** 顺着 `export { name } from` 与 `export * from` 找到真正定义该名字的模块。 */
function locateDefinitions(
  module: string,
  name: string,
  scans: ReadonlyMap<string, ModuleScan>,
  files: ReadonlySet<string>,
  seen: Set<string> = new Set(),
): string[] {
  const key = `${module}\u0000${name}`;
  if (seen.has(key)) return [];
  seen.add(key);

  const scan = scans.get(module);
  if (!scan) return [];

  const found: string[] = [];
  if (scan.exports.some((symbol) => symbol.name === name)) found.push(module);
  for (const reExport of scan.reExports) {
    if (reExport.name !== name) continue;
    const target = resolveModule(module, reExport.specifier, files);
    if (target) found.push(...locateDefinitions(target, name, scans, files, seen));
  }
  for (const star of scan.stars) {
    const target = resolveModule(module, star, files);
    if (target) found.push(...locateDefinitions(target, name, scans, files, seen));
  }
  return found;
}

/** 模块对外暴露的全部名字，含 `export * from` 带出来的。 */
function exportedNames(
  module: string,
  scans: ReadonlyMap<string, ModuleScan>,
  files: ReadonlySet<string>,
  seen: Set<string> = new Set(),
): Set<string> {
  if (seen.has(module)) return new Set();
  seen.add(module);

  const scan = scans.get(module);
  if (!scan) return new Set();

  const names = new Set(scan.exports.map((symbol) => symbol.name));
  for (const star of scan.stars) {
    const target = resolveModule(module, star, files);
    if (!target) continue;
    for (const name of exportedNames(target, scans, files, seen)) names.add(name);
  }
  return names;
}

/**
 * 建引用索引。定义文件自身的使用不算引用：导出是给别的模块用的，本文件内部的调用
 * 证明不了这个导出有人需要。
 */
function buildReferenceIndex(scans: ReadonlyMap<string, ModuleScan>): ReferenceIndex {
  const files = new Set(scans.keys());
  const collected = new Map<string, Map<string, Set<string>>>();

  const record = (target: string, name: string, origin: string) => {
    if (target === origin) return;
    let byName = collected.get(target);
    if (!byName) {
      byName = new Map();
      collected.set(target, byName);
    }
    let origins = byName.get(name);
    if (!origins) {
      origins = new Set();
      byName.set(name, origins);
    }
    origins.add(origin);
  };

  for (const [origin, scan] of scans) {
    for (const imported of scan.imports) {
      const target = resolveModule(origin, imported.specifier, files);
      if (!target) continue;

      const names = new Set(imported.named);
      if (imported.defaultRef) names.add("default");
      for (const name of names) {
        for (const defining of locateDefinitions(target, name, scans, files)) record(defining, name, origin);
      }

      if (!imported.namespaceRef) continue;
      for (const name of exportedNames(target, scans, files)) {
        for (const defining of locateDefinitions(target, name, scans, files)) record(defining, name, origin);
      }
      record(target, ALL_EXPORTS, origin);
    }
  }

  const index = new Map<string, Map<string, readonly string[]>>();
  for (const [target, byName] of collected) {
    const names = new Map<string, readonly string[]>();
    for (const [name, origins] of byName) names.set(name, [...origins].sort());
    index.set(target, names);
  }
  return index;
}

/** 从源码文本建引用索引。 */
export function indexReferences(sources: ReadonlyMap<string, string>): ReferenceIndex {
  const scans = new Map<string, ModuleScan>();
  for (const [filePath, sourceText] of sources) scans.set(filePath, scanModule(filePath, sourceText));
  return buildReferenceIndex(scans);
}

/** 某个导出在受管源码里的引用方文件，去重后按路径排序。 */
export function referencesFor(index: ReferenceIndex, file: string, name: string): readonly string[] {
  const byName = index.get(file);
  if (!byName) return [];
  const origins = new Set(byName.get(name) ?? []);
  for (const origin of byName.get(ALL_EXPORTS) ?? []) origins.add(origin);
  return [...origins].sort();
}

/** 基线文件放在仓库根，记录上线时的存量无引用导出。 */
export const BASELINE_FILE = "coverage-export-baseline.json";

/** 基线条目的键：路径、导出名与种类，三者共同定位一个存量符号。 */
export function baselineKey(path: string, name: string, kind: ExportKind): string {
  return `${path}#${name}#${kind}`;
}

/** 解析基线文件。结构不合法时抛出，由调用方把原因写进报告。 */
function parseBaseline(text: string): BaselineEntry[] {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) throw new Error("基线文件不是对象");
  const symbols = "symbols" in parsed ? parsed.symbols : undefined;
  if (!Array.isArray(symbols)) throw new Error("基线文件缺少 symbols 数组");

  const entries: BaselineEntry[] = [];
  for (const raw of symbols) {
    if (typeof raw !== "object" || raw === null) throw new Error("基线条目不是对象");
    const path = "path" in raw ? raw.path : undefined;
    const name = "name" in raw ? raw.name : undefined;
    const kind = "kind" in raw ? raw.kind : undefined;
    if (typeof path !== "string" || typeof name !== "string") {
      throw new Error("基线条目缺少 path 或 name");
    }
    if (kind !== "type" && kind !== "runtime") {
      throw new Error(`基线条目 ${path}#${name} 的 kind 必须是 type 或 runtime`);
    }
    entries.push({ path, name, kind });
  }
  return entries;
}

/** 源码读取的注入点：测试传固定样本，生产读工作区与分叉点版本。 */
interface SourceReaders {
  readWorkspace(path: string): Promise<string>;
  readAtMergeBase(path: string): Promise<string | null>;
}

interface CollectExportUsageOptions {
  changedFiles: readonly ChangedFile[];
  managedFiles: readonly string[];
  readers: SourceReaders;
  /** 基线文件内容；文件不存在时传 null。 */
  baselineText: string | null;
}

/**
 * 采集一次判定所需的全部数据：工作区源码的引用索引、改动文件两侧的导出对比、
 * 基线里的存量条目。
 */
export async function collectExportUsage(options: CollectExportUsageOptions): Promise<ExportAnalysis> {
  // 改动清单里的未跟踪新文件不在 `git ls-files` 里，但要一并扫描：本地运行时规则
  // 与检查里看到同一批文件。
  const paths = new Set(options.managedFiles);
  for (const change of options.changedFiles) paths.add(change.path);

  const scans = new Map<string, ModuleScan>();
  const texts = await Promise.all([...paths].sort().map(async (filePath) => {
    const text = await options.readers.readWorkspace(filePath);
    return [filePath, text] as const;
  }));
  for (const [filePath, text] of texts) scans.set(filePath, scanModule(filePath, text));

  const baseline = new Set<string>();
  let baselineError: string | undefined;
  if (options.baselineText !== null) {
    try {
      for (const entry of parseBaseline(options.baselineText)) {
        baseline.add(baselineKey(entry.path, entry.name, entry.kind));
      }
    } catch (error) {
      baselineError = error instanceof Error ? error.message : String(error);
    }
  }

  const added: AddedExport[] = [];
  for (const change of options.changedFiles) {
    const headExports = scans.get(change.path)?.exports ?? [];
    if (headExports.length === 0) continue;

    const basePath = change.previousPath ?? change.path;
    const baseText = change.status === "added" ? null : await options.readers.readAtMergeBase(basePath);
    const baseKeys = new Set((baseText === null ? [] : extractExports(basePath, baseText)).map(
      (symbol) => `${symbol.name}\u0000${symbol.kind}`,
    ));
    for (const symbol of headExports) {
      if (!baseKeys.has(`${symbol.name}\u0000${symbol.kind}`)) added.push({ file: change.path, symbol });
    }
  }

  return {
    added,
    references: buildReferenceIndex(scans),
    baseline,
    scannedFiles: scans.size,
    ...(baselineError === undefined ? {} : { baselineError }),
  };
}
