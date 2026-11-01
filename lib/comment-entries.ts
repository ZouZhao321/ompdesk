import ts from "typescript";

/** 注释词条的语言：文本里出现中文字符即中文，否则英文。 */
export type CommentLanguage = "zh" | "en";

export function isCommentLanguage(value: unknown): value is CommentLanguage {
  return value === "zh" || value === "en";
}

export interface CommentSourceFile {
  /** 相对于项目根目录的路径，使用 `/` 分隔。 */
  path: string;
  content: string;
}

export interface CommentEntry {
  filePath: string;
  /** 1 起始的源码行号。 */
  startLine: number;
  endLine: number;
  /** 去掉注释符号并压缩空白后的文本。 */
  text: string;
  language: CommentLanguage;
}

export interface CommentExtraction {
  entries: CommentEntry[];
  excluded: number;
  /** 扫描过的源文件数。 */
  files: number;
}

/** 依赖、产物、工作副本与临时目录都不参与扫描。 */
const SKIPPED_DIRS: Record<string, true> = {
  ".git": true,
  ".next": true,
  ".tmp": true,
  ".turbo": true,
  ".worktrees": true,
  build: true,
  coverage: true,
  dist: true,
  node_modules: true,
  out: true,
  target: true,
  vendor: true,
};

const SOURCE_EXTENSIONS: Record<string, true> = { ".ts": true, ".tsx": true };

const WORD_RE = /\p{L}+/gu;
const HAN_RE = /\p{Script=Han}/u;

export function isSkippedCommentSourceDir(name: string): boolean {
  return SKIPPED_DIRS[name.toLowerCase()] === true;
}

export function isCommentSourceFile(relativePath: string): boolean {
  const segments = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  const fileName = segments.at(-1);
  if (!fileName) return false;
  if (segments.slice(0, -1).some((segment) => isSkippedCommentSourceDir(segment))) return false;
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return false;
  return SOURCE_EXTENSIONS[fileName.slice(dot).toLowerCase()] === true;
}

interface RawComment {
  kind: "line" | "block";
  startLine: number;
  endLine: number;
  body: string;
}

/**
 * 提取文件内容里的注释词条。纯函数：文件内容由调用方传入，不读磁盘。
 * 顺序固定为文件路径码元顺序，文件内按起始行号。
 */
export function extractCommentEntries(files: CommentSourceFile[]): CommentExtraction {
  const entries: CommentEntry[] = [];
  let excluded = 0;
  const ordered = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  for (const file of ordered) {
    for (const comment of mergeLineComments(readComments(file.content))) {
      const body = comment.kind === "block"
        ? comment.body.split("\n").map((line) => line.replace(/^\s*\*+\s?/, "")).join("\n")
        : comment.body;
      const text = normalizeCommentText(body);
      if (isExcludedComment(text)) {
        excluded++;
        continue;
      }
      entries.push({
        filePath: file.path,
        startLine: comment.startLine,
        endLine: comment.endLine,
        text,
        language: HAN_RE.test(text) ? "zh" : "en",
      });
    }
  }

  return { entries, excluded, files: ordered.length };
}

/** 行首偏移表，把字符位置换算成 1 起始行号。 */
function lineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index++) {
    if (content[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function lineAt(starts: readonly number[], position: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle] <= position) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

/**
 * 扫描到这些 token 之后，`/` 是除号；其余位置按正则字面量的起点处理，
 * 由 reScanSlashToken 一并消费正则内部的反斜杠与字符类。
 */
const EXPRESSION_END_TOKENS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.Identifier,
  ts.SyntaxKind.PrivateIdentifier,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.CloseParenToken,
  ts.SyntaxKind.CloseBracketToken,
  ts.SyntaxKind.CloseBraceToken,
  ts.SyntaxKind.ThisKeyword,
  ts.SyntaxKind.SuperKeyword,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
  ts.SyntaxKind.PlusPlusToken,
  ts.SyntaxKind.MinusMinusToken,
]);

/**
 * 用 TypeScript 扫描器取注释 trivia。字符串、模板与正则字面量由扫描器整体消费，
 * 其中的引号、反斜杠与 `//` 不会被当成注释。
 */
function readComments(content: string): RawComment[] {
  const starts = lineStarts(content);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, content);
  const comments: RawComment[] = [];
  let expectExpression = true;

  while (true) {
    let token = scanner.scan();
    if (token === ts.SyntaxKind.EndOfFileToken) break;
    if (token === ts.SyntaxKind.SlashToken && expectExpression) {
      token = scanner.reScanSlashToken();
    }

    const text = scanner.getTokenText();
    const start = scanner.getTokenPos();
    const end = scanner.getTextPos();

    if (token >= ts.SyntaxKind.FirstTriviaToken && token <= ts.SyntaxKind.LastTriviaToken) {
      if (token === ts.SyntaxKind.SingleLineCommentTrivia) {
        const line = lineAt(starts, start);
        comments.push({ kind: "line", startLine: line, endLine: line, body: text.slice(2) });
      } else if (token === ts.SyntaxKind.MultiLineCommentTrivia) {
        const body = text.slice(2, text.endsWith("*/") ? -2 : undefined);
        comments.push({
          kind: "block",
          startLine: lineAt(starts, start),
          endLine: lineAt(starts, Math.max(start, end - 1)),
          body,
        });
      }
      continue;
    }

    expectExpression = !EXPRESSION_END_TOKENS.has(token);
  }

  return comments;
}

/** 连续的单行注释合并为一条；块注释各自独立。 */
function mergeLineComments(comments: RawComment[]): RawComment[] {
  const merged: RawComment[] = [];
  for (const comment of comments) {
    const last = merged[merged.length - 1];
    if (comment.kind === "line" && last?.kind === "line" && comment.startLine === last.endLine + 1) {
      last.endLine = comment.endLine;
      last.body += `\n${comment.body}`;
      continue;
    }
    merged.push({ ...comment });
  }
  return merged;
}

/** 多行合并为一段，连续空白压成一个空格。 */
export function normalizeCommentText(text: string): string {
  return text.split("\n").join(" ").replace(/\s+/g, " ").trim();
}

/**
 * 字典键 = 归一化后的整块注释文本 + 目标语言。
 * 缩进与换行的差异不改变键；调用方传入已去掉注释符号前缀的文本。
 */
export function commentEntryKey(text: string, targetLanguage: CommentLanguage): string {
  return `${normalizeCommentText(text)}\u0000${targetLanguage}`;
}

/** 译文的目标语言始终是原文语言的另一种。 */
export function translationTargetLanguage(language: CommentLanguage): CommentLanguage {
  return language === "zh" ? "en" : "zh";
}

/** 词条的字典键：归一化文本加上译文目标语言。 */
export function commentTranslationKey(entry: CommentEntry): string {
  return commentEntryKey(entry.text, translationTargetLanguage(entry.language));
}

/**
 * 纯符号横幅没有任何单词；只含一个单词的分隔标题也排除。
 * 中文没有空格，单个中文词可能是一整句说明，因此单词语判定只针对拉丁字母文本。
 */
function isExcludedComment(text: string): boolean {
  const words = text.match(WORD_RE) ?? [];
  if (words.length === 0) return true;
  return words.length === 1 && !HAN_RE.test(text);
}

