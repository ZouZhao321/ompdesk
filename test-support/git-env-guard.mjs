import assert from "node:assert/strict";
import ts from "typescript";

/**
 * git 调用环境守卫的共享扫描。
 *
 * 用 TypeScript 的 AST 判定，不做字符配对：注释与字符串里的同名文本不会误算，参数里的
 * 括号也不会截断文本；正则扫源码则会把注释里出现的 `env: createGitEnv()` 也算进去，
 * 漏掉写在共享 options 变量里的那几处。
 *
 * 只认一条规则：首个参数是字面量 `"git"` 的调用。不看函数名，所以 `execFile`、`spawn`、
 * `execFileSync` 以及 `const run = execFileAsync` 这类换名字的包装都会扫到；先把 `"git"`
 * 存进变量再传的调用 AST 追不到，靠调用方的模块清单与 `subprocessCallSiteLines()` 的逐调用点
 * 核对兜底。
 */

const GIT_LITERAL_RE = /(["'`])git\1/;

/**
 * 子进程入口清单。扫描器按首参认 git、不看函数名，调用点清单必须按同一批入口建：只钉一个
 * 名字的话，模块改用 `spawn`、`execFileSync` 之后合规调用会被判成漏扫，而
 * `execFile(gitBinary, …)` 这种首参存变量的调用反而两边都看不见。
 */
export const SUBPROCESS_ENTRY_POINTS = Object.freeze([
  "exec",
  "execFile",
  "execFileSync",
  "execSync",
  "fork",
  "spawn",
  "spawnSync",
]);

/** 文本预筛：与下面的 AST 规则同形，供调用方在解析前跳过不碰 git 的文件。 */
export function mentionsGitLiteral(source) {
  return GIT_LITERAL_RE.test(source);
}

/** 按扩展名选解析模式，`.tsx` 里的 JSX 与 `.mjs` 里的纯 JS 各自按对应语法解析。 */
function scriptKindFor(filename) {
  if (filename.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (/\.(mjs|cjs|js|jsx)$/.test(filename)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** 解析源码；`filename` 只用于选择解析模式与报错定位。 */
function parseSource(source, filename) {
  return ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, scriptKindFor(filename));
}

/** 调用点在源码里的行号（从 1 起），用于报错定位。 */
function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

/**
 * 变量声明按所在作用域建表：同名声明出现在不同块里时各归各的块，解析时沿祖先链取最近的
 * 那一份。按名字建一张全局表会让后出现的声明盖掉前一份，把没剥离环境的调用判成合规。
 */
function declarationScopes(sourceFile) {
  const scopes = new Map();
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      let scope = node.parent;
      while (
        scope &&
        !ts.isBlock(scope) &&
        !ts.isSourceFile(scope) &&
        !ts.isModuleBlock(scope) &&
        !ts.isCaseBlock(scope)
      ) {
        scope = scope.parent;
      }
      if (scope) {
        if (!scopes.has(scope)) scopes.set(scope, new Map());
        scopes.get(scope).set(node.name.text, node);
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
  return scopes;
}

/** 把 options 参数还原成对象字面量：直接写的字面量，或作用域链上最近的同名变量声明。 */
function resolveObjectLiteral(node, scopes) {
  if (!node) return null;
  if (ts.isObjectLiteralExpression(node)) return node;
  if (!ts.isIdentifier(node)) return null;
  for (let scope = node.parent; scope; scope = scope.parent) {
    const declaration = scopes.get(scope)?.get(node.text);
    if (declaration) {
      return ts.isObjectLiteralExpression(declaration.initializer) ? declaration.initializer : null;
    }
  }
  return null;
}

/**
 * 字面量 `"git"`：普通字符串或无插值的模板字符串。带插值的模板不是字面量，扫不到。
 */
function isGitLiteral(node) {
  if (!node) return false;
  return (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === "git";
}

/**
 * 子进程 API 的 options 一般排第三位（`execFile(file, args, options)`），`exec` 一类
 * 排第二位。取第一个能还原成对象字面量的实参，两种形状都覆盖。
 */
function findOptionsArgument(call, scopes) {
  for (const argument of call.arguments.slice(1)) {
    const objectLiteral = resolveObjectLiteral(argument, scopes);
    if (objectLiteral) return objectLiteral;
  }
  return null;
}

/**
 * 取出源码里每个首参为字面量 `"git"` 的调用，解析出它的 options 对象。
 * `filename` 只用于选择解析模式与报错定位。
 */
export function gitSubprocessCalls(source, filename = "source.ts") {
  const sourceFile = parseSource(source, filename);
  const declarations = declarationScopes(sourceFile);

  const calls = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && isGitLiteral(node.arguments[0])) {
      calls.push({
        line: lineOf(sourceFile, node),
        options: findOptionsArgument(node, declarations),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

/**
 * 被调用的名字：标识符本身，或属性访问的最后一段（`cp.execFile`、`util.promisify`）。
 * 正则字面量的 `.exec` 也落进这段，本守卫只用于 git 子进程模块，误报方向是多数一条。
 */
function referenceName(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return null;
}

/** 命名空间成员的引用：`cp.execFile`，且 `cp` 来自 `child_process`。 */
function isNamespaceMember(expression, namespaces) {
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    namespaces.has(expression.expression.text) &&
    SUBPROCESS_ENTRY_POINTS.includes(expression.name.text)
  );
}

/** `promisify(execFile)` 与 `promisify(cp.execFile)` 这类把入口包一层的写法。 */
function isPromisifiedEntry(expression, names, namespaces) {
  if (!ts.isCallExpression(expression)) return false;
  if (referenceName(expression.expression) !== "promisify") return false;
  return expression.arguments.some(
    (argument) => names.has(referenceName(argument)) || isNamespaceMember(argument, namespaces),
  );
}

/**
 * 初始化表达式是否只是入口的别名：`const run = execFile`、`const run = cp.execFile`、
 * `const execFileAsync = promisify(execFile)`。
 */
function aliasesEntryPoint(expression, names, namespaces) {
  return (
    names.has(referenceName(expression)) ||
    isNamespaceMember(expression, namespaces) ||
    isPromisifiedEntry(expression, names, namespaces)
  );
}

/**
 * 入口名集合：给定的初始名字（默认是清单里的名字），加上本地声明的别名。别名套别名按声明
 * 迭代到不再新增，`const run = execFileAsync` 也能解析到 `execFile`。
 */
function entryPointNames(sourceFile, seeds = SUBPROCESS_ENTRY_POINTS, namespaces = new Set()) {
  const names = new Set(seeds);
  const declarations = [];
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declarations.push(node);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  let added = true;
  while (added) {
    added = false;
    for (const declaration of declarations) {
      if (names.has(declaration.name.text)) continue;
      if (aliasesEntryPoint(declaration.initializer, names, namespaces)) {
        names.add(declaration.name.text);
        added = true;
      }
    }
  }
  return names;
}

/** 模块名是 `child_process` 的两种写法。 */
function isChildProcessModule(specifier) {
  return specifier === "child_process" || specifier === "node:child_process";
}

/** `require("child_process")` 调用，供 CommonJS 的 `bin/` 脚本识别入口名。 */
function isChildProcessRequire(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "require" &&
    node.arguments.length > 0 &&
    ts.isStringLiteral(node.arguments[0]) &&
    isChildProcessModule(node.arguments[0].text)
  );
}

/** `import("child_process")` 或 `await import("child_process")`。 */
function isChildProcessDynamicImport(node) {
  const expression = ts.isAwaitExpression(node) ? node.expression : node;
  return (
    ts.isCallExpression(expression) &&
    expression.expression.kind === ts.SyntaxKind.ImportKeyword &&
    expression.arguments.length > 0 &&
    ts.isStringLiteral(expression.arguments[0]) &&
    isChildProcessModule(expression.arguments[0].text)
  );
}

/** 初始化表达式是否取到整个 `child_process` 模块：`require(…)` 或动态 `import(…)`。 */
function isChildProcessModuleExpression(node) {
  return isChildProcessRequire(node) || isChildProcessDynamicImport(node);
}

/**
 * 从 `child_process` 导入或解构出来的绑定。按来源认子进程调用，不按名字硬匹配：`regex.exec()`
 * 这类同名方法不会误算，而 `execFile(gitBinary, …)` 这类换个名字调用的写法仍认得出。
 * 默认导入与动态导入都按命名空间处理。返回 `named`（具名绑定）与 `namespaces`（模块对象绑定）。
 */
function childProcessBindings(sourceFile) {
  const named = new Set();
  const namespaces = new Set();
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isChildProcessModule(node.moduleSpecifier.text)
    ) {
      const clause = node.importClause;
      if (clause?.name) namespaces.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          if (SUBPROCESS_ENTRY_POINTS.includes(imported)) named.add(element.name.text);
        }
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        namespaces.add(bindings.name.text);
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer && isChildProcessModuleExpression(node.initializer)) {
      if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          const source = element.propertyName ?? element.name;
          if (ts.isIdentifier(source) && SUBPROCESS_ENTRY_POINTS.includes(source.text)) {
            named.add(element.name.text);
          }
        }
      } else if (ts.isIdentifier(node.name)) {
        namespaces.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { named, namespaces };
}

/** 源码是否取用到 `child_process` 模块，用于「提到模块却没有调用点」的检查。 */
export function mentionsChildProcessModule(source, filename = "source.ts") {
  const { named, namespaces } = childProcessBindings(parseSource(source, filename));
  return named.size > 0 || namespaces.size > 0;
}

/**
 * 源码里每个子进程调用、它的 options 对象，以及 `windowsHide` 是否确实挡住了窗口。
 * 入口名只认从 `child_process` 导入或解构出来的绑定，加上 `promisify(execFile)` 这类本地
 * 别名；同名的普通方法（`pattern.exec(…)`）不在其中。
 */
export function subprocessCalls(source, filename = "source.ts") {
  const sourceFile = parseSource(source, filename);
  const declarations = declarationScopes(sourceFile);
  const { named, namespaces } = childProcessBindings(sourceFile);
  const names = entryPointNames(sourceFile, named, namespaces);
  const windowFlags = windowFlagNames(sourceFile);

  const calls = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (isNamespaceMember(callee, namespaces) || (ts.isIdentifier(callee) && names.has(callee.text))) {
        const options = findOptionsArgument(node, declarations);
        calls.push({
          line: lineOf(sourceFile, node),
          options,
          hiddenWindow: options ? hidesChildWindow(options, windowFlags, declarations) : false,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

/** 共享窗口开关所在的模块与导出名；`lib/subprocess-window.ts`。 */
const WINDOW_FLAG_MODULE = "subprocess-window";
const WINDOW_FLAG_NAME = "HIDE_CHILD_WINDOW";

/** 从共享窗口开关模块导入的本地名字。 */
function windowFlagNames(sourceFile) {
  const names = new Set();
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      const fromModule = specifier === WINDOW_FLAG_MODULE || specifier.endsWith(`/${WINDOW_FLAG_MODULE}`);
      const bindings = node.importClause?.namedBindings;
      if (fromModule && bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if ((element.propertyName ?? element.name).text === WINDOW_FLAG_NAME) names.add(element.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

/** 对象字面量里最后一个同名属性；重复键时生效的是最后一个。 */
function lastProperty(objectLiteral, propertyName) {
  let found = null;
  for (const property of objectLiteral.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      if (property.name.text === propertyName) found = property;
      continue;
    }
    if (!ts.isPropertyAssignment(property)) continue;
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
    if (name === propertyName) found = property;
  }
  return found;
}

/** 标识符在作用域链上最近的变量声明；参数与导入都不在其中。 */
function resolveDeclaration(identifier, declarations) {
  for (let scope = identifier.parent; scope; scope = scope.parent) {
    const declaration = declarations.get(scope)?.get(identifier.text);
    if (declaration) return declaration;
  }
  return null;
}

/**
 * `windowsHide` 的取值是否挡住窗口。字面量 `true` 直接算；计算表达式交给作者，字面量
 * `false` 一律不算；标识符按最近的声明判定：本地重新声明的同名变量不算冒名通过，
 * `detached` 要求同一份 options 里也传了它，其余只认共享开关模块的导入。
 */
function hidesChildWindow(objectLiteral, windowFlags, declarations) {
  const property = lastProperty(objectLiteral, "windowsHide");
  if (!property) return false;
  if (ts.isShorthandPropertyAssignment(property)) return false;

  const value = property.initializer;
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (!ts.isIdentifier(value)) return true;

  const declaration = resolveDeclaration(value, declarations);
  const reassigned = declaration !== null && declaration.initializer?.kind === ts.SyntaxKind.FalseKeyword;
  if (value.text === "detached") return !reassigned && lastProperty(objectLiteral, "detached") !== null;
  if (declaration) return false;
  return windowFlags.has(value.text);
}

/**
 * 断言每个子进程调用都挡住了控制台窗口。后台服务没有控制台，Windows 上子进程会各开一个
 * 可见的控制台窗口；`windowsHide` 是唯一挡住它的开关。`label` 指明出处，用在报错里。
 */
export function assertHiddenWindow(calls, label) {
  for (const { line, options, hiddenWindow } of calls) {
    assert.ok(options, `${label} 第 ${line} 行的子进程调用必须传 options 对象字面量`);
    assert.ok(
      hiddenWindow,
      `${label} 第 ${line} 行的子进程调用要传 windowsHide: HIDE_CHILD_WINDOW（或 true；继承启动器控制台时写 detached）`,
    );
  }
}

/**
 * 收集源码里全部子进程入口的调用点行号。入口名取 `SUBPROCESS_ENTRY_POINTS`、属性访问写法
 * （`cp.spawn`）与本地别名（`const execFileAsync = promisify(execFile)`）。扫描器只认首参为
 * 字面量 `"git"` 的调用，先把首参存进变量的调用它追不到：调用方用这份清单核对模块里的
 * 子进程调用点都被扫到，光数扫到的条数挡不住漏扫。
 */
export function subprocessCallSiteLines(source, filename = "source.ts") {
  const sourceFile = parseSource(source, filename);
  const names = entryPointNames(sourceFile);
  const lines = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && names.has(referenceName(node.expression))) {
      lines.push(lineOf(sourceFile, node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return lines;
}

/** 对象字面量里是否有 `env: createGitEnv()` 属性。 */
export function hasCreateGitEnvProperty(objectLiteral) {
  return objectLiteral.properties.some((property) => {
    if (!ts.isPropertyAssignment(property)) return false;
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
    return (
      name === "env" &&
      ts.isCallExpression(property.initializer) &&
      ts.isIdentifier(property.initializer.expression) &&
      property.initializer.expression.text === "createGitEnv"
    );
  });
}

/**
 * 断言每个 git 调用都显式传了剥离后的环境。`label` 指明出处，用在报错里；`calls` 为空时
 * 由调用方自己断言调用数量，守卫不替它表态。
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
