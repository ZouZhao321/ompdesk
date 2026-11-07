/**
 * 译文的逐字片段校验。
 *
 * 原文里的路径、标识符、数字与括号片段在译文中必须逐字出现，缺任何一项就说明
 * 模型把代码事实改写掉了。校验是纯函数：只比较两段文本，不读磁盘、不访问模型。
 */

/** 译文中必须逐字保留的片段类别。 */
export type ProtectedFragmentKind = "path" | "identifier" | "number" | "brackets";

export interface ProtectedFragment {
  kind: ProtectedFragmentKind;
  value: string;
}

export interface TranslationValidation {
  ok: boolean;
  /** 译文里缺失的片段，按原文出现顺序排列且不重复。 */
  missing: ProtectedFragment[];
}

const BRACKET_CLOSERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/** 括号片段之外的词元分隔符：空白、中英文标点与括号本身。 */
const TOKEN_SPLIT_RE = /[\s,;:!?。，、；：！？"'“”‘’()\[\]{}<>]+/u;

/** 带至少一个斜杠的路径；匹配后再去掉结尾的句读标点。 */
const PATH_RE = /\/?[A-Za-z0-9_.@~-]+(?:\/[A-Za-z0-9_.@~-]+)+/gu;

/** 文件名与扩展名；扩展名至少两个字符，避免把 e.g 一类缩写当成路径。 */
const FILE_NAME_RE = /(?<![A-Za-z0-9_@.-])(?:[A-Za-z0-9_@-]+\.)+[A-Za-z][A-Za-z0-9]{1,7}(?![A-Za-z0-9_])/gu;

const PLAIN_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const FLAG_RE = /^--[A-Za-z][A-Za-z0-9_-]*$/u;
const NUMBER_TOKEN_RE = /^\d+(?:[.,]\d+)*$/u;

/** 调用形式 `name(`，覆盖全小写的函数名与变量名。 */
const CALL_RE = /(?<![A-Za-z0-9_$])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gu;

/** 数字本身：整数、小数，以及千分位逗号分隔的数字。 */
const NUMBER_RE = /\d+(?:[.,]\d+)*/gu;

/**
 * 最外层的成对括号整段保留。未闭合的括号不参与校验，因为普通文本里单独的
 * 左括号无法判断是否真的承载代码片段。
 */
function bracketFragments(text: string): string[] {
  const fragments: string[] = [];
  const stack: Array<{ open: string; at: number }> = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (!char) continue;
    if (char in BRACKET_CLOSERS) {
      stack.push({ open: char, at: index });
      continue;
    }
    const top = stack.at(-1);
    if (!top || BRACKET_CLOSERS[top.open] !== char) continue;
    stack.pop();
    if (stack.length > 0) continue;
    const fragment = text.slice(top.at, index + 1);
    if (fragment.slice(1, -1).trim()) fragments.push(fragment);
  }
  return fragments;
}

/**
 * 代码标识符的判定按书写形态收窄：含下划线、内部大写（camelCase / PascalCase /
 * 缩写）、含数字、以 `$` 或 `_` 开头。普通英文单词因此不会被要求逐字保留。
 */
function isCodeIdentifier(value: string): boolean {
  if (value.length < 2 || !PLAIN_IDENTIFIER_RE.test(value)) return false;
  return /[A-Z]/.test(value.slice(1)) || value.includes("_") || /\d/.test(value) || value.startsWith("$");
}

/** 原文中必须逐字保留的片段，按出现顺序去重。 */
export function protectedFragments(original: string): ProtectedFragment[] {
  const fragments: ProtectedFragment[] = [];
  const seen = new Set<string>();
  const push = (kind: ProtectedFragmentKind, value: string): void => {
    if (!value) return;
    const id = `${kind}\u0000${value}`;
    if (seen.has(id)) return;
    seen.add(id);
    fragments.push({ kind, value });
  };

  for (const fragment of bracketFragments(original)) push("brackets", fragment);

  for (const match of original.matchAll(PATH_RE)) push("path", match[0].replace(/[.,;:]+$/u, ""));
  // 路径里已经含有的文件名不再单独要求一次。
  const paths = fragments.filter((fragment) => fragment.kind === "path").map((fragment) => fragment.value);
  for (const match of original.matchAll(FILE_NAME_RE)) {
    const value = match[0].replace(/[.,;:]+$/u, "");
    if (paths.some((path) => path !== value && path.endsWith(value))) continue;
    push("path", value);
  }

  for (const raw of original.split(TOKEN_SPLIT_RE)) {
    const token = raw.replace(/^\.+|\.+$/gu, "");
    if (!token) continue;
    if (NUMBER_TOKEN_RE.test(token)) {
      push("number", token);
      continue;
    }
    if (FLAG_RE.test(token) || isCodeIdentifier(token)) push("identifier", token);
  }

  for (const match of original.matchAll(CALL_RE)) {
    const name = match[1];
    if (name && isCodeIdentifier(name)) push("identifier", name);
  }
  for (const match of original.matchAll(NUMBER_RE)) push("number", match[0]);

  return fragments;
}

/** 译文是否逐字保留了原文的全部受保护片段；空译文一律判失败。 */
export function validateTranslation(original: string, translation: string): TranslationValidation {
  const fragments = protectedFragments(original);
  const text = translation.trim();
  if (!text) return { ok: false, missing: fragments };
  const missing = fragments.filter((fragment) => !text.includes(fragment.value));
  return { ok: missing.length === 0, missing };
}
