import { spawn } from "child_process";
import { createGitEnv } from "./git-env";

/** 判定超时；大目录的输入可能有几 MB，输出只包含命中的名字。 */
const GIT_CHECK_IGNORE_TIMEOUT_MS = 10_000;
const GIT_CHECK_IGNORE_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * 询问 Git 哪些名字被忽略规则命中。名字相对 dirPath，返回命中的名字集合。
 * 返回 null 表示无法判定（不是仓库、Git 不可用、超时、输出超限），
 * 调用方据此按正常状态显示，不把它当成错误。
 */
export function checkIgnoredEntries(dirPath: string, names: string[]): Promise<Set<string> | null> {
 if (names.length === 0) return Promise.resolve(new Set());

 const { promise, resolve } = Promise.withResolvers<Set<string> | null>();
 const child = spawn("git", ["-C", dirPath, "check-ignore", "-z", "--stdin"], {
  env: createGitEnv(),
  windowsHide: true,
  stdio: ["pipe", "pipe", "ignore"],
 });
 const chunks: Buffer[] = [];
 let received = 0;
 let settled = false;

 const finish = (value: Set<string> | null) => {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  resolve(value);
 };

 const timer = setTimeout(() => {
  child.kill();
  finish(null);
 }, GIT_CHECK_IGNORE_TIMEOUT_MS);

 child.stdout.on("data", (chunk: Buffer) => {
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
 child.stdin.on("error", () => {
  // git 提前退出时管道会断开，结果以退出码为准。
 });
 child.stdin.end(names.join("\0") + "\0");
 return promise;
}
