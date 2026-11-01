/** 注释词条的语言，由文本里中文字符与拉丁字母的数量关系决定。 */
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
const HAN_COUNT_RE = /\p{Script=Han}/gu;
const LATIN_COUNT_RE = /[A-Za-z]/g;

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
        language: commentLanguage(text),
      });
    }
  }

  return { entries, excluded };
}

/** 逐字符扫描，跳过字符串字面量里的注释符号，并跨行跟踪块注释。 */
function readComments(content: string): RawComment[] {
  const comments: RawComment[] = [];
  let index = 0;
  let line = 1;
  let inBlock = false;
  let blockStart = 1;
  let blockBody = "";
  let quote: string | null = null;

  while (index < content.length) {
    const char = content[index];
    const next = content[index + 1];

    if (char === "\n") {
      line++;
      // 单双引号字符串不跨行；未闭合时在新行恢复，避免吞掉后续注释。
      if (quote !== "`") quote = null;
      if (inBlock) blockBody += "\n";
      index++;
      continue;
    }

    if (inBlock) {
      if (char === "*" && next === "/") {
        comments.push({ kind: "block", startLine: blockStart, endLine: line, body: blockBody });
        inBlock = false;
        blockBody = "";
        index += 2;
        continue;
      }
      blockBody += char;
      index++;
      continue;
    }

    if (quote) {
      if (char === "\\") {
        if (next === "\n") line++;
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index++;
      continue;
    }

    if (char === "/" && next === "/") {
      let end = index + 2;
      while (end < content.length && content[end] !== "\n") end++;
      comments.push({ kind: "line", startLine: line, endLine: line, body: content.slice(index + 2, end) });
      index = end;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlock = true;
      blockStart = line;
      blockBody = "";
      index += 2;
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      index++;
      continue;
    }

    index++;
  }

  if (inBlock) {
    comments.push({ kind: "block", startLine: blockStart, endLine: line, body: blockBody });
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

/**
 * 纯符号横幅没有任何单词；只含一个单词的分隔标题也排除。
 * 中文没有空格，单个中文词可能是一整句说明，因此单词语判定只针对拉丁字母文本。
 */
function isExcludedComment(text: string): boolean {
  const words = text.match(WORD_RE) ?? [];
  if (words.length === 0) return true;
  return words.length === 1 && !HAN_RE.test(text);
}

/** 中文字符占比达到一半时归入左栏，否则归入右栏。 */
function commentLanguage(text: string): CommentLanguage {
  const han = text.match(HAN_COUNT_RE)?.length ?? 0;
  const latin = text.match(LATIN_COUNT_RE)?.length ?? 0;
  return han > 0 && han >= latin ? "zh" : "en";
}
