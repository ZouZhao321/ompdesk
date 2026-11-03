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
 * 这里判断的是「该用 win32 的路径 API 处理这个输入吗」，不是「这是不是 Windows 绝对
 * 路径」。`file-access.ts` 的 `isWindowsAbsolutePath`（`path-security.ts` 里有一份同实现
 * 的私有副本）负责后一件事，用于选择解析 API 并做根目录包含判断。两个判定有意在两处
 * 不同，`directory-browser.test.mjs` 的跨模块用例逐条钉住：
 *
 * - `C:folder` 与 `C:`：盘符相对输入不是绝对路径，`isWindowsAbsolutePath` 判 false；
 *   这里判 true，因为它已经限定在 Windows，只是没有根，归一化时要走宿主的盘符当前目录。
 * - `\Users`：Windows 的根相对写法，宿主是 Windows 时这里判 true；它不是绝对路径，
 *   `isWindowsAbsolutePath` 判 false。POSIX 上 `\data\log` 是合法的相对名字，只有
 *   Windows 宿主才按 Windows 判断。盘符不在判定范围内：`\work` 与 `/work` 都只给到
 *   当前盘符的根，由 `normalizeDirectory` 按启动器 cwd 的盘符补全。
 * - `//server/share`：任何宿主上都是 UNC，`isWindowsAbsolutePath` 判 true；这里在 POSIX
 *   上判 false。POSIX 上 `//tmp/x` 与 `/tmp/x` 等价，判成 Windows 会让 `path.win32` 把它
 *   归一成 `\\tmp\x`，随后 stat 失败。
 *
 * 其余输入两侧一致：`C:\x`、`C:/x` 与 `\\server\share` 都判 true，`/x` 与普通相对名字
 * 都判 false。
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

  // 不能一律用宿主平台的 `path`：在 Windows 上它把 `/Users/alex/project` 判成盘符路径，
  // 在 POSIX 上又把 `C:\Users` 当成普通名字。先按输入形态选 API。
  const pathApi = isWindowsPathInput(directory) ? path.win32 : path.posix;

  // 不带盘符的绝对输入（`\work`、`/work`）在 Windows 上指向「当前盘符」的根：原样返回给
  // 文件系统，就由服务器进程的当前盘符决定，启动器在 D 盘、服务器在 C 盘时 `\work` 会
  // 落到 `C:\work`。这里按启动器 cwd 的盘符补全，与相对输入共用同一个基准。UNC 输入
  // （`\\server\share`）自带根，不是根相对，仍走下面的绝对分支。
  if (process.platform === "win32" && /^[\\/](?![\\/])/.test(directory)) {
    return path.win32.resolve(process.env.OMPDESK_LAUNCH_CWD ?? process.cwd(), directory);
  }

  // 绝对输入自带根，按输入形态规整即可；交给宿主 path 会把别平台的路径拼成盘符路径。
  // `normalize` 会保留结尾分隔符，同一目录就有 `/a/b/` 与 `/a/b` 两种形态；相对输入分支
  // 用宿主 `resolve` 天然去掉它，这里同样剥掉根目录以外的结尾分隔符。只剥所选 API 的
  // 分隔符：POSIX 下反斜杠是合法文件名字符，`/tmp/foo\` 指的是名字以反斜杠结尾的目录，
  // 跟着一起剥就指到了别的路径。不能直接用 `pathApi.resolve`：UNC 共享根之外，它还会按
  // 进程自身的盘符状态补全，把没有根的输入指到别处。
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
  // 与 `normalizeDirectory` 同一套选择规则：Windows 形态自带分隔符语义，用 win32；
  // POSIX 绝对输入用 posix；相对输入的上级由宿主状态决定，必须用宿主 `path`——交给
  // posix 会把 Windows 宿主上的 `Users\alex` 当成一个名字，上级判成 `.`。
  const pathApi = isWindowsPathInput(directory)
    ? path.win32
    : (path.posix.isAbsolute(directory) ? path.posix : path);
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
