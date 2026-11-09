#!/usr/bin/env bun
/**
 * 提交前排版：把本次暂存过的文件交给对应分组改写，再重新加入暂存区。
 *
 * 三组各用一份配置，互不影响：
 * - ts/tsx/mjs/js/cjs → prettier/code.config.json
 * - css               → prettier/css.config.json
 * - json              → prettier/json.config.json
 *
 * 只处理暂存区里的文件：pre-commit 运行前会把未暂存的改动收起来，写到别处会与它
 * 冲突。Prettier 没有「只排暂存文件」的开关，按暂存清单分批传路径，避免超过
 * Windows 的命令行长度上限。
 *
 * 排版差异不构成失败：改写后重新 `git add`，让本次提交直接带上排版结果。
 * 工具自身报错（配置不合法、语法错误）才以非零状态退出，阻止提交。
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { createGitEnv } from "../lib/git-env";

const ROOT = join(import.meta.dirname, "..");
const GROUPS = [
  {
    label: "code",
    config: "prettier/code.config.json",
    extensions: new Set([".ts", ".tsx", ".mjs", ".js", ".cjs"]),
  },
  { label: "css", config: "prettier/css.config.json", extensions: new Set([".css"]) },
  { label: "json", config: "prettier/json.config.json", extensions: new Set([".json"]) },
];
// 一次传太多路径会超过 Windows 的命令行长度上限，按批调用即可。
const BATCH_SIZE = 100;

/** 暂存区里本次新增或修改过的文件；已删除的文件不参与排版。 */
function stagedFiles() {
  const result = spawnSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], {
    cwd: ROOT,
    env: createGitEnv(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    process.exit(result.status ?? 1);
  }
  return result.stdout.split("\0").filter((path) => path.length > 0 && existsSync(join(ROOT, path)));
}

function batches(files) {
  const result = [];
  for (let index = 0; index < files.length; index += BATCH_SIZE) {
    result.push(files.slice(index, index + BATCH_SIZE));
  }
  return result;
}

const files = stagedFiles();
const prettierBin = join(ROOT, "node_modules", "prettier", "bin", "prettier.cjs");
let formatted = 0;

for (const group of GROUPS) {
  const selected = files.filter((path) => group.extensions.has(extname(path).toLowerCase()));
  for (const batch of batches(selected)) {
    const result = spawnSync(process.execPath, [prettierBin, "--config", group.config, "--write", ...batch], {
      cwd: ROOT,
      env: createGitEnv(),
      stdio: "inherit",
    });
    if (result.error || result.status !== 0) {
      process.stderr.write(`[format] ${group.label} 分组排版失败，提交中止。\n`);
      process.exit(result.status ?? 1);
    }
  }
  formatted += selected.length;
}

if (formatted === 0) process.exit(0);

// 工具改写的是工作区文件，重新加入暂存区，提交内容才与工作区一致。
const restage = spawnSync("git", ["add", "--", ...files], {
  cwd: ROOT,
  env: createGitEnv(),
  stdio: "inherit",
});
if (restage.status !== 0) process.exit(restage.status ?? 1);
process.stdout.write(`[format] 已排版并重新暂存 ${formatted} 个文件。\n`);
