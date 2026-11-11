import { execFile } from "child_process";
import { promisify } from "util";
import { createGitEnv } from "./git-env";

const execFileAsync = promisify(execFile);

/** 列举超时；大仓库一次输出可能到几十 MB，所以放宽缓冲上限。 */
const GIT_LIST_TIMEOUT_MS = 10_000;
const GIT_LIST_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * 列举 git 跟踪的文件与未忽略的未跟踪文件，路径相对 cwd 并用 `/` 分隔。
 * 排除范围由 .gitignore 决定。不是 git 仓库或 git 不可用时返回 null，
 * 调用方据此退回目录遍历。
 */
export async function listGitFiles(cwd: string): Promise<string[] | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", cwd, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      {
        timeout: GIT_LIST_TIMEOUT_MS,
        maxBuffer: GIT_LIST_MAX_BUFFER,
        windowsHide: true,
        env: createGitEnv(),
      },
    );
    return stdout.split("\0").filter(Boolean);
  } catch {
    // 这里的 catch 用于探测仓库是否存在，不是吞掉失败：非仓库时 git 退出非零，
    // 由调用方换用目录遍历。
    return null;
  }
}
