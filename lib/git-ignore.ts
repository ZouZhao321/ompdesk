import { spawn, type ChildProcess } from "child_process";
import { createGitEnv } from "./git-env";

/** 判定超时；大目录的输入可能有几 MB，输出只包含命中的名字。 */
const GIT_CHECK_IGNORE_TIMEOUT_MS = 10_000;
const GIT_CHECK_IGNORE_MAX_BUFFER = 64 * 1024 * 1024;
/** 刷新会重复请求同一批名字，短 TTL 抵消这段重复开销。 */
const IGNORE_CACHE_TTL_MS = 5_000;
const IGNORE_CACHE_MAX_ENTRIES = 100;

interface IgnoreCacheEntry {
  namesKey: string;
  result: Set<string> | null;
  expiresAt: number;
}

const ignoreCache = new Map<string, IgnoreCacheEntry>();

/** 名字集合的 32 位哈希：文件名变化后缓存自然失效。 */
function hashNames(names: string[]): string {
  let hash = 2166136261;
  for (const name of names) {
    for (let index = 0; index < name.length; index += 1) {
      hash ^= name.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 0;
    hash = Math.imul(hash, 16777619);
  }
  return `${names.length}:${hash >>> 0}`;
}

function writeCache(dirPath: string, namesKey: string, result: Set<string> | null): void {
  ignoreCache.delete(dirPath);
  ignoreCache.set(dirPath, { namesKey, result, expiresAt: Date.now() + IGNORE_CACHE_TTL_MS });
  while (ignoreCache.size > IGNORE_CACHE_MAX_ENTRIES) {
    const oldest = ignoreCache.keys().next().value;
    if (oldest === undefined) break;
    ignoreCache.delete(oldest);
  }
}

/**
 * 询问 Git 哪些名字被忽略规则命中。名字相对 dirPath，返回命中的名字集合。
 * 返回 null 表示无法判定（不是仓库、Git 不可用、超时、输出超限），
 * 调用方据此按正常状态显示，不把它当成错误。
 */
export function checkIgnoredEntries(dirPath: string, names: string[]): Promise<Set<string> | null> {
  if (names.length === 0) return Promise.resolve(new Set());

  const namesKey = hashNames(names);
  const cached = ignoreCache.get(dirPath);
  if (cached && cached.namesKey === namesKey && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.result);
  }
  if (cached) ignoreCache.delete(dirPath);

  const { promise, resolve } = Promise.withResolvers<Set<string> | null>();
  let child: ChildProcess;
  try {
    child = spawn("git", ["-C", dirPath, "check-ignore", "-z", "--stdin"], {
      env: createGitEnv(),
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
  } catch {
    return Promise.resolve(null);
  }

  const stdout = child.stdout;
  const stdin = child.stdin;
  if (!stdout || !stdin) {
    child.kill();
    return Promise.resolve(null);
  }

  const chunks: Buffer[] = [];
  let received = 0;
  let settled = false;

  const timer = setTimeout(() => {
    child.kill();
    finish(null);
  }, GIT_CHECK_IGNORE_TIMEOUT_MS);

  const finish = (value: Set<string> | null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    writeCache(dirPath, namesKey, value);
    resolve(value);
  };

  stdout.on("error", () => finish(null));
  stdout.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received > GIT_CHECK_IGNORE_MAX_BUFFER) {
      child.kill();
      finish(null);
      return;
    }
    chunks.push(chunk);
  });
  child.on("error", () => finish(null));
  child.on("close", (code) => {
    if (code === 0) {
      finish(new Set(Buffer.concat(chunks).toString("utf8").split("\0").filter(Boolean)));
    } else if (code === 1) {
      finish(new Set());
    } else {
      finish(null);
    }
  });
  stdin.on("error", () => {
    // git 提前退出时管道会断开，结果以退出码为准。
  });
  stdin.end(names.join("\0") + "\0");
  return promise;
}
