/**
 * Next 的产物目录名：默认 `.next`，按版本分开后形如 `.next-v1.0.28`
 * （见 `bin/runtime.js` 的 `resolveDistDir`）。
 *
 * 文件索引、文件浏览器与注释扫描都要跳过它：产物目录里的 `.ts`、`.d.ts` 是
 * 构建生成的，不是项目源码。
 */
export function isNextDistDirName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === ".next" || lower.startsWith(".next-");
}
