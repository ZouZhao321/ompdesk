/**
 * 语法树解析的共用入口。
 *
 * 导入解析、导出扫描与函数名提取都要先把源码文本读成语法树，三处此前各写一份扩展名到
 * ScriptKind 的映射与候选后缀表，扩展名一多就会走岔。这里只留一份：改这里，三处一起变。
 */

import ts from "typescript";

/** 参与解析的源码扩展名。 */
export const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"] as const;

/** 无扩展名导入的候选后缀；目录导入取 `index`。顺序即解析优先级。 */
export const MODULE_SUFFIXES = [
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
] as const;

const SCRIPT_KIND_BY_EXTENSION: Record<string, ts.ScriptKind> = {
  ts: ts.ScriptKind.TS,
  mts: ts.ScriptKind.TS,
  cts: ts.ScriptKind.TS,
  tsx: ts.ScriptKind.TSX,
  js: ts.ScriptKind.JS,
  jsx: ts.ScriptKind.JSX,
  mjs: ts.ScriptKind.JS,
  cjs: ts.ScriptKind.JS,
};

/** 扩展名对应的 ScriptKind；认不出时按 TS 解析，语法树仍可用。 */
function scriptKindOf(filePath: string): ts.ScriptKind {
  const extension = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
  return SCRIPT_KIND_BY_EXTENSION[extension] ?? ts.ScriptKind.TS;
}

/**
 * 把源码文本解析成语法树。不读磁盘、不做类型检查，只做结构扫描。
 *
 * `setParentNodes` 默认关掉：结构扫描只往下走。需要从节点反查上下文（动态导入要判断
 * 结果被绑到了哪个变量）时打开，代价是每个节点多一个 `parent` 引用。
 */
export function parseSource(filePath: string, sourceText: string, setParentNodes = false): ts.SourceFile {
  return ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, setParentNodes, scriptKindOf(filePath));
}
