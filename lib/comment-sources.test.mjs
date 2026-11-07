import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { listCommentSourcePaths, readCommentSourceFiles, walkCommentSourcePaths } =
	await jiti.import("./comment-sources.ts");
const { extractCommentEntries } = await jiti.import("./comment-entries.ts");
const { createGitEnv } = await jiti.import("./git-env.ts");

function makeRoot(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "ompdesk-comment-sources-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	return root;
}

function write(root, relativePath, content) {
	const target = path.join(root, relativePath);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, content);
}

function git(root, ...args) {
	// git 钩子会注入 GIT_DIR 等仓库定位变量，盖过 -C；测试自建仓库前先摘掉。
	execFileSync("git", ["-C", root, ...args], {
		stdio: ["ignore", "ignore", "pipe"],
		env: createGitEnv(),
	});
}

test("git 仓库只取跟踪与未忽略的源码，被忽略的备份目录不出现", async (t) => {
	const root = makeRoot(t);
	write(root, ".gitignore", ".backups/\n");
	write(root, "src/tracked.ts", "// 跟踪的源码\nconst a = 1;\n");
	write(root, "src/fresh.tsx", "/* 未跟踪但未忽略 */\n");
	write(root, ".backups/components/Old.tsx", "// 被忽略的备份副本\n");
	write(root, "src/notes.md", "# 不是词条来源\n");
	git(root, "init", "-q");
	git(root, "add", ".gitignore", "src/tracked.ts");

	assert.deepEqual((await listCommentSourcePaths(root)).sort(), ["src/fresh.tsx", "src/tracked.ts"]);
});

test("环境残留 GIT_DIR 时仍按目标目录判定仓库", async (t) => {
	const root = makeRoot(t);
	write(root, ".gitignore", "ignored/\n");
	write(root, "src/a.ts", "// 源码\n");
	write(root, "ignored/legacy.ts", "// 被忽略的源码\n");
	git(root, "init", "-q");
	git(root, "add", ".gitignore", "src/a.ts");

	const other = makeRoot(t);
	write(other, "elsewhere.ts", "// 别的仓库\n");
	git(other, "init", "-q");
	git(other, "add", "elsewhere.ts");

	// 目标目录是真实仓库，且带一个被 .gitignore 排除的源文件：目录遍历不看 .gitignore，
	// 会把 ignored/legacy.ts 算进来，git 列举则排除它。差异就是这个用例的鉴别力——
	// 剥离失效时读到 other/elsewhere.ts，剥离后误走回退遍历时多出 ignored/legacy.ts，
	// 两种情况都跑不出下面的期望。
	assert.deepEqual(walkCommentSourcePaths(root).sort(), ["ignored/legacy.ts", "src/a.ts"]);

	const previous = process.env.GIT_DIR;
	process.env.GIT_DIR = path.join(other, ".git");
	t.after(() => {
		if (previous === undefined) delete process.env.GIT_DIR;
		else process.env.GIT_DIR = previous;
	});

	assert.deepEqual(await listCommentSourcePaths(root), ["src/a.ts"]);
});

test("同一份内容两次提取结果一致", async (t) => {
	const root = makeRoot(t);
	write(root, ".gitignore", ".backups/\n");
	write(root, "src/a.ts", "// 中文说明\n// 第二行\nconst a = 1;\n");
	write(root, "src/b.tsx", "/** English block */\nexport const b = 1;\n");
	write(root, ".backups/a_20261102-120000.ts", "// 被忽略的备份副本\n");
	git(root, "init", "-q");
	git(root, "add", ".gitignore", "src/a.ts", "src/b.tsx");

	const first = extractCommentEntries(await readCommentSourceFiles(root));
	const second = extractCommentEntries(await readCommentSourceFiles(root));

	assert.deepEqual(second, first);
	assert.deepEqual([...new Set(first.entries.map((entry) => entry.filePath))], ["src/a.ts", "src/b.tsx"]);
});

test("非仓库退回目录遍历并沿用跳过名单", (t) => {
	const root = makeRoot(t);
	write(root, "src/a.ts", "// 源码\n");
	write(root, "src/b.tsx", "/* 源码 */\n");
	write(root, "src/c.js", "// 不是词条来源\n");
	write(root, "node_modules/pkg/index.ts", "// 依赖\n");
	write(root, ".worktrees/w/index.ts", "// 工作副本\n");
	write(root, ".tmp/scratch/index.ts", "// 临时文件\n");
	write(root, ".next/types/x.ts", "// 产物\n");

	assert.deepEqual(walkCommentSourcePaths(root).sort(), ["src/a.ts", "src/b.tsx"]);
});
