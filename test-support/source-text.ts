import { readFile } from "node:fs/promises";

/**
 * 读取源码并压平空白与括号内多余空格。
 *
 * 断言只比较代码结构：缩进、换行、折行位置，以及多行调用补出的尾逗号都不影响结果。
 * 大括号内部保持原样，`{ a: 1 }` 这类按对象写的断言仍能匹配。
 */
export async function readSource(url: URL): Promise<string> {
  const text = await readFile(url, "utf8");
  return text
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\[\s+/g, "[")
    .replace(/\s+\]/g, "]")
    .replace(/\s+,/g, ",")
    .replace(/,\s*\)/g, ")")
    .replace(/,\s*\]/g, "]")
    .replace(/\s+;/g, ";");
}
