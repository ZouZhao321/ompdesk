import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createGitEnv } from "../git-env";
import { HIDE_CHILD_WINDOW } from "../subprocess-window";
import { SOURCE_EXTENSIONS } from "./source-scan";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

/** 改动类型只区分门禁要用的三类；删除不进改动清单。 */
export type ChangeStatus = "added" | "modified" | "renamed";

export interface ChangedFile {
  /** 改动后的路径，相对仓库根，`/` 分隔。 */
  path: string;
  status: ChangeStatus;
  /** 改名前的路径，仅 `renamed` 时存在。 */
  previousPath?: string;
}

/** 只作为生产引用来源、不参与覆盖率判定的目录。 */
const REFERENCE_ONLY_DIRECTORIES = ["scripts/"];
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/;

/**
 * 生产引用来源：仓库里所有不是测试的源码。`scripts/` 与 `bin/` 也在内——它们由命令行按
 * 路径调用，不产生 `import` 之外的入口，但确实使用了被测模块的导出。
 *
 * 测试文件与 `test-support/` 不算生产引用；声明文件没有可执行代码，也排除。
 */
export function isReferenceSourceFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.startsWith("test-support/")) return false;
  if (TEST_FILE_RE.test(normalized) || normalized.endsWith(".d.ts")) return false;
  return SOURCE_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}

/**
 * 受管源文件：参与覆盖率门禁的代码文件。在引用来源之外再排除 `scripts/`：这些脚本
 * 不被测试加载，进覆盖率分母只会压低数字。
 */
export function isManagedSourceFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  if (REFERENCE_ONLY_DIRECTORIES.some((directory) => normalized.startsWith(directory))) return false;
  return isReferenceSourceFile(normalized);
}

/**
 * 测试源文件：按命名规则认出的测试文件。被动覆盖的静态检查要读它们的导入语句。
 */
function isTestFileSource(filePath: string): boolean {
  return TEST_FILE_RE.test(filePath.replace(/\\/g, "/"));
}

/**
 * 解析 `git diff --name-status -z -M` 的输出，并并入未跟踪文件。
 * `-z` 下记录形如 `M\0path\0` 或 `R100\0old\0new\0`；删除的记录跳过。
 */
function parseChangedFiles(diffOutput: string, untrackedOutput = ""): ChangedFile[] {
  const changes = new Map<string, ChangedFile>();
  const tokens = diffOutput.split("\0");

  for (let index = 0; index < tokens.length; ) {
    const status = tokens[index++];
    if (!status) continue;
    const code = status[0];

    if (code === "R" || code === "C") {
      const previousPath = tokens[index++];
      const path = tokens[index++];
      if (!path) continue;
      changes.set(path, code === "R" ? { path, status: "renamed", previousPath } : { path, status: "added" });
      continue;
    }

    const path = tokens[index++];
    if (!path) continue;
    if (code === "D") {
      changes.delete(path);
      continue;
    }
    changes.set(path, { path, status: code === "A" ? "added" : "modified" });
  }

  for (const path of untrackedOutput.split("\0")) {
    if (path && !changes.has(path)) changes.set(path, { path, status: "added" });
  }

  return [...changes.values()].sort((left, right) => left.path.localeCompare(right.path));
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    windowsHide: HIDE_CHILD_WINDOW,
    env: createGitEnv(),
  });
  return stdout;
}

/** 仓库根目录的绝对路径。lcov 里的路径与改动清单都以它为基准。 */
export async function repositoryRoot(cwd: string): Promise<string> {
  const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
  if (!root) throw new Error("git rev-parse --show-toplevel 没有返回仓库根目录");
  return root;
}

/**
 * 分叉点。基准取合并目标分支与 HEAD 的 merge base；检出深度不足时 git 返回非零，
 * 由调用方把 fetch-depth 提示写进报告。
 */
export async function resolveMergeBase(cwd: string, baseRef: string): Promise<string> {
  const mergeBase = (await git(cwd, ["merge-base", baseRef, "HEAD"])).trim();
  if (!/^[0-9a-f]{40,64}$/i.test(mergeBase)) {
    throw new Error(`无法解析 ${baseRef} 与 HEAD 的分叉点`);
  }
  return mergeBase;
}

/**
 * 改动清单：分叉点到工作区的差异，含新增、修改与改名后的路径；未跟踪文件按新增
 * 计入，本地未提交时报告不会漏掉新文件。清空的工作区里这一项为空。
 */
export async function listChangedFiles(cwd: string, mergeBase: string): Promise<ChangedFile[]> {
  const [diffOutput, untrackedOutput] = await Promise.all([
    git(cwd, ["diff", "--name-status", "-z", "-M", mergeBase, "--"]),
    git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  return parseChangedFiles(diffOutput, untrackedOutput);
}

/** 受管源文件清单，来自 `git ls-files`，按路径排序。 */
export async function listManagedSourceFiles(cwd: string): Promise<string[]> {
  const output = await git(cwd, ["ls-files", "-z"]);
  return output.split("\0").filter(isManagedSourceFile).sort();
}

/** 测试文件清单，来自同一次 `git ls-files`，按路径排序。 */
export async function listTestFiles(cwd: string): Promise<string[]> {
  const output = await git(cwd, ["ls-files", "-z"]);
  return output.split("\0").filter(isTestFileSource).sort();
}

/** 生产引用来源清单：受管源文件加上 `scripts/` 与 `bin/`，按路径排序。 */
export async function listReferenceSourceFiles(cwd: string): Promise<string[]> {
  const output = await git(cwd, ["ls-files", "-z"]);
  return output.split("\0").filter(isReferenceSourceFile).sort();
}

/** 某个提交里的全部文件，按路径排序。生成基线时按分叉点的文件清单扫描。 */
export async function listFilesAtRevision(cwd: string, revision: string): Promise<string[]> {
  const output = await git(cwd, ["ls-tree", "-r", "--name-only", "-z", revision]);
  return output
    .split("\0")
    .filter((filePath) => filePath.length > 0)
    .sort();
}

/**
 * 分叉点以来被删除的受管源文件。改名不算删除；拆分后旧文件消失时这里会有记录，
 * 门禁据此判断要不要做结构改造的对应。
 */
export async function listDeletedFiles(cwd: string, mergeBase: string): Promise<string[]> {
  const output = await git(cwd, ["diff", "--name-only", "--diff-filter=D", "-z", mergeBase]);
  return output
    .split("\0")
    .filter((path) => path.length > 0 && isManagedSourceFile(path))
    .sort();
}

/** 读取某个版本里的文件内容；文件在该版本不存在时返回 null（新增与删除的常规情形）。 */
export async function readFileAtRevision(cwd: string, revision: string, filePath: string): Promise<string | null> {
  try {
    return await git(cwd, ["show", `${revision}:${filePath}`]);
  } catch {
    // 这里的 catch 用于探测文件是否存在，不是吞掉失败：`git show` 在路径缺席时
    // 以非零退出，调用方按空内容处理。
    return null;
  }
}
