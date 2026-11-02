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
 * 盘符与反斜杠开头的 UNC 在任何宿主上都只能是 Windows 路径；正斜杠开头的
 * `//server/share` 只有 Windows 宿主才当 UNC：POSIX 上 `//tmp/x` 与 `/tmp/x`
 * 等价，判成 Windows 会让 `path.win32` 把它归一成 `\\tmp\x`，随后 stat 失败。
 */
export function isWindowsPathInput(
  directory: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (/^[a-zA-Z]:[\\/]/.test(directory)) return true;
  if (directory.startsWith("\\\\")) return true;
  return platform === "win32" && directory.startsWith("//");
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
  if (pathApi.isAbsolute(directory)) return pathApi.normalize(directory);

  // 相对输入的基准是启动器注入的宿主 cwd，必须用宿主 path 拼接。
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
