/**
 * 源码断言用的文本视图：把排版压平，让断言只比较代码结构。
 *
 * 直接对源码字符串做正则，会把断言绑在缩进、折行位置与多行调用补出的尾逗号上，
 * 排版一变就整批失配。这里统一把连续空白折成一个空格，并去掉括号/方括号/花括号
 * 内侧的多余空格与 `, )`、`, ]`、` }` 形式的尾逗号，两侧（源码与断言）都按这个
 * 形态比较即可。
 */
import { readFile } from "node:fs/promises";

/**
 * 压平排版：连续空白折成一个空格，去掉括号内侧空格与尾逗号。
 *
 * 只处理结构性的空白，字符串字面量里的内容保持原样（单行字符串不会跨行）。
 */
export function flattenSource(text: string): string {
  return (
    text
      .replace(/\s+/g, " ")
      // 尾逗号：多行调用、数组、对象收尾时补出的那一颗
      .replace(/,\s*\)/g, ")")
      .replace(/,\s*\]/g, "]")
      .replace(/,\s*\}/g, " }")
      // 开括号后的空白
      .replace(/\(\s+/g, "(")
      .replace(/\[\s+/g, "[")
      // 闭括号、逗号、分号前的空白
      .replace(/\s+\)/g, ")")
      .replace(/\s+\]/g, "]")
      .replace(/\s+,/g, ",")
      .replace(/\s+;/g, ";")
  );
}

/** 读取源码文件并返回压平排版后的文本。 */
export async function readSourceFile(path: string | URL): Promise<string> {
  return flattenSource(await readFile(path, "utf8"));
}

/**
 * 取最近一次出现的 `marker` 所在的整块（从 marker 起、按花括号配对到闭合处）。
 *
 * 压平后的文本没有行结构，块的边界只能按括号算：原先按 `\n}` 找块尾的断言在这里
 * 会切到文件末尾或空串。
 */
export function extractBlock(text: string, marker: string): string {
  const start = text.lastIndexOf(marker);
  if (start < 0) throw new Error(`源码缺少锚点：${marker}`);
  const open = text.indexOf("{", start);
  if (open < 0) throw new Error(`锚点后面没有块：${marker}`);
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  throw new Error(`块没有闭合：${marker}`);
}
