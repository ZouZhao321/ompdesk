#!/usr/bin/env bun
/**
 * 提交前排版：把本次暂存过的文件交给对应工具改写，再重新加入暂存区。
 *
 * 两类文件由不同工具负责，配置各自独立：
 * - ts/tsx/mjs/js/cjs 交给 Biome（biome.json：Tab、缩进宽 3、行宽 120）
 * - css/json 交给 Prettier（.prettierrc）
 *
 * 只处理暂存区里的文件：pre-commit 运行前会把未暂存的改动收起来，工具写到别处
 * 会与它冲突。Biome 自带 `--staged`，一次调用即可；Prettier 没有对应开关，按
 * 暂存清单分批传路径，避免超过 Windows 的命令行长度上限。
 *
 * 排版差异不构成失败：改写后重新 `git add`，让本次提交直接带上排版结果。
 * 工具自身报错（配置不合法、语法错误）才以非零状态退出，阻止提交。
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { createGitEnv } from "../lib/git-env";

const ROOT = join(import.meta.dirname, "..");
const CODE_EXTS = new Set([".ts", ".tsx", ".mjs", ".js", ".cjs"]);
const DATA_EXTS = new Set([".css", ".json"]);
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

function select(files, extensions) {
	return files.filter((path) => extensions.has(extname(path).toLowerCase()));
}

function batches(files) {
	const result = [];
	for (let index = 0; index < files.length; index += BATCH_SIZE) {
		result.push(files.slice(index, index + BATCH_SIZE));
	}
	return result;
}

/** 调用某个工具；返回 false 表示它报错。 */
function run(label, executable, args) {
	const result = spawnSync(executable, args, { cwd: ROOT, env: createGitEnv(), stdio: "inherit" });
	if (result.error) {
		process.stderr.write(`[format] ${label} 无法执行：${result.error.message}\n`);
		return false;
	}
	return result.status === 0;
}

const files = stagedFiles();
const code = select(files, CODE_EXTS);
const data = select(files, DATA_EXTS);
if (code.length === 0 && data.length === 0) process.exit(0);

const biomeBin = join(ROOT, "node_modules", "@biomejs", "biome", "bin", "biome");
const prettierBin = join(ROOT, "node_modules", "prettier", "bin", "prettier.cjs");

if (code.length > 0 && !run("biome", process.execPath, [biomeBin, "format", "--write", "--staged"])) {
	process.stderr.write("[format] Biome 排版失败，提交中止。\n");
	process.exit(1);
}
for (const batch of batches(data)) {
	if (!run("prettier", process.execPath, [prettierBin, "--write", ...batch])) {
		process.stderr.write("[format] Prettier 排版失败，提交中止。\n");
		process.exit(1);
	}
}

// 工具改写的是工作区文件，重新加入暂存区，提交内容才与工作区一致。
const restage = spawnSync("git", ["add", "--", ...files], { cwd: ROOT, env: createGitEnv(), stdio: "inherit" });
if (restage.status !== 0) process.exit(restage.status ?? 1);
process.stdout.write(`[format] 已排版并重新暂存 ${files.length} 个文件。\n`);
