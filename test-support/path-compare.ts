/**
 * 目录比较键：判断两个路径是否指向同一个目录（或一个在另一个之内）时统一用它归一。
 *
 * 只做 `resolve` 会漏掉两类差异：符号链接（macOS 的 `/var` → `/private/var`、被换成
 * 链接的 `~/.omp`）与大小写不敏感平台（Windows 与 macOS 默认）上的大小写。配置根
 * 守卫、活动 agent 目录守卫与沙箱删除前的检查都用这一份实现，任一处用别的规则，
 * 就会出现「一边判定在外部、一边把仍在使用的目录删掉」。
 */
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** 目录比较键：真实路径优先，缺失的尾段拼回最近的已存在祖先之上，大小写不敏感平台统一折叠。 */
export function comparableDirectory(directory: string): string {
  const real = realPathOfNearestAncestor(resolve(directory));
  return process.platform === "win32" || process.platform === "darwin" ? real.toLowerCase() : real;
}

/**
 * `realpath` 只接受已存在的路径。路径还不存在时从最近的已存在祖先开始解析，再把
 * 缺失的尾段拼回去：整条路径解析失败就退回字面路径的话，祖先里的符号链接会漏掉，
 * 两侧一半真实路径一半字面路径，包含关系就会漏判。只有 ENOENT/ENOTDIR 视为缺失，
 * 其他错误照常抛出。
 */
function realPathOfNearestAncestor(absolute: string): string {
  const missing: string[] = [];
  let current = absolute;
  for (;;) {
    try {
      return join(realpathSync(current), ...missing);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = dirname(current);
      // 到根目录仍解析不到真实路径：没有可用的祖先，按字面路径比较。
      if (parent === current) return absolute;
      missing.unshift(basename(current));
      current = parent;
    }
  }
}
