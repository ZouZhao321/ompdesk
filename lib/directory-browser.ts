import { readdir, realpath, stat } from "fs/promises";
import { homedir } from "os";
import path from "path";

export interface BrowsableDirectory {
  name: string;
  path: string;
}

export function shouldShowWindowsDrivePicker(
  directory?: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32" && !directory;
}

export function getBrowseStartDirectory(directory?: string): string {
  return directory || homedir();
}

export function getWindowsDriveCandidates(): BrowsableDirectory[] {
  return "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => ({
    name: `${letter}:`,
    path: `${letter}:\\`,
  }));
}

export async function listWindowsDrives(): Promise<BrowsableDirectory[]> {
  const candidates = await Promise.all(getWindowsDriveCandidates().map(async (drive) => {
    try {
      const driveStat = await stat(drive.path);
      return driveStat.isDirectory() ? drive : null;
    } catch {
      return null;
    }
  }));

  return candidates.filter((drive): drive is BrowsableDirectory => drive !== null);
}

/**
 * 按输入形态判断是不是 Windows 路径。
 *
 * 盘符形态（`C:\x`、`C:/x` 与盘符相对的 `C:x`）与双反斜杠开头的 UNC 在任何宿主上
 * 都只能是 Windows 路径。单个反斜杠开头的 `\Users` 只是 Windows 的根相对写法：
 * POSIX 上 `\data\log` 是合法的相对名字，只有 Windows 宿主才按 Windows 判断，
 * 这与 `file-access.ts` 的 `isWindowsAbsolutePath` 一致。正斜杠开头的
 * `//server/share` 同理只在 Windows 宿主上才当 UNC：POSIX 上 `//tmp/x` 与 `/tmp/x`
 * 等价，判成 Windows 会让 `path.win32` 把它归一成 `\\tmp\x`，随后 stat 失败。
 */
export function isWindowsPathInput(
  directory: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (/^[a-zA-Z]:/.test(directory)) return true;
  if (directory.startsWith("\\\\")) return true;
  return platform === "win32" && (directory.startsWith("\\") || directory.startsWith("//"));
}

export function normalizeDirectory(directory: string): string {
  if (directory === "~") return homedir();
  if (/^~[\\/]/.test(directory)) {
    const suffix = directory.slice(2).replace(/[\\/]+/g, path.sep);
    return path.resolve(homedir(), suffix);
  }

  // 不能用宿主平台的 `path` 代替：在 Windows 上它把 `/Users/alex/project` 当成
  // win32 路径解析成 `\\Users\\alex`，POSIX 输入的 `/` 语义会丢。
  const pathApi = isWindowsPathInput(directory) ? path.win32 : path.posix;
  // 绝对输入自带根，按输入形态规整即可；交给宿主 path 会把别平台的路径拼成盘符路径。
  // `normalize` 会保留结尾分隔符，同一目录就有 `/a/b/` 与 `/a/b` 两种形态；相对输入分支
  // 用宿主 `resolve` 天然去掉它，这里同样剥掉根目录以外的结尾分隔符。只剥所选 API 的
  // 分隔符：POSIX 下反斜杠是合法文件名字符，`/tmp/foo\` 指的是名字以反斜杠结尾的目录，
  // 跟着一起剥就指到了别的路径。不能直接用 `pathApi.resolve`：
  // `path.win32.resolve("\\Users\\alex")` 会补上当前盘符（`C:\Users\alex`），把根相对输入
  // 指到别处。
  if (pathApi.isAbsolute(directory)) {
    const normalized = pathApi.normalize(directory);
    const root = pathApi.parse(normalized).root;
    let end = normalized.length;
    while (end > root.length && normalized[end - 1] === pathApi.sep) end -= 1;
    return normalized.slice(0, end);
  }

  // 相对输入的基准是宿主状态，必须用宿主 path 拼接。普通相对路径的基准是启动器注入的
  // 宿主 cwd；盘符相对输入（`C:folder`，盘符后没有分隔符，`path.win32.isAbsolute` 判
  // false）的基准是「C 盘的当前目录」——Windows 宿主有这个状态，宿主 `path.resolve` 就
  // 按它解析；POSIX 宿主没有盘符当前目录，只能落成 `<hostCwd>/C:folder`，该路径在
  // POSIX 上并不存在，但输入不会被 win32 归一成 `C:\folder` 而指向别处。两种形态的
  // 结果都由 normalizeDirectory 用例固定。
  return path.resolve(process.env.OMPDESK_LAUNCH_CWD ?? process.cwd(), directory);
}

export function getParentDirectory(directory: string): string | null {
  const pathApi = isWindowsPathInput(directory) ? path.win32 : path.posix;
  const normalized = pathApi.normalize(directory);
  const parent = pathApi.dirname(normalized);
  return parent === normalized ? null : parent;
}

export async function resolveDirectory(directory: string): Promise<string> {
  return realpath(normalizeDirectory(directory));
}

export async function listDirectories(directory: string): Promise<BrowsableDirectory[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  // 忽略损坏、不可访问或不指向目录的符号链接。
  const candidates = await Promise.all(entries.map(async (entry) => {
    if (entry.isDirectory()) {
      return { name: entry.name, path: path.join(directory, entry.name) };
    }
    if (!entry.isSymbolicLink()) return null;

    try {
      const entryPath = path.join(directory, entry.name);
      const realEntryPath = await realpath(entryPath);
      const entryStat = await stat(realEntryPath);
      if (!entryStat.isDirectory()) return null;
      return { name: entry.name, path: entryPath };
    } catch {
      return null;
    }
  }));

  return candidates
    .filter((entry): entry is BrowsableDirectory => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}
