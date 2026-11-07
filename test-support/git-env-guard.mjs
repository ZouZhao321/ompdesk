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

/** `promisify(execFile)` 与 `promisify(cp.execFile)` 这类把入口包一层的写法。 */
function isPromisifiedEntry(expression, names) {
	if (!ts.isCallExpression(expression)) return false;
	if (referenceName(expression.expression) !== "promisify") return false;
	return expression.arguments.some((argument) => names.has(referenceName(argument)));
}

/** 初始化表达式是否只是入口的别名：`const run = execFile`、`const execFileAsync = promisify(execFile)`。 */
function aliasesEntryPoint(expression, names) {
	return names.has(referenceName(expression)) || isPromisifiedEntry(expression, names);
}

/**
 * 入口名集合：清单里的六个名字，加上本地声明的别名。别名套别名按声明迭代到不再新增，
 * `const run = execFileAsync` 也能解析到 `execFile`。
 */
function entryPointNames(sourceFile) {
	const names = new Set(SUBPROCESS_ENTRY_POINTS);
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
			if (aliasesEntryPoint(declaration.initializer, names)) {
				names.add(declaration.name.text);
				added = true;
			}
		}
	}
	return names;
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
