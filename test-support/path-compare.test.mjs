/**
 * `comparableDirectory` 的直接测试。
 *
 * 它是配置根守卫、活动 agent 目录守卫与沙箱删除前检查共用的归一规则：规则松一处，
 * 守卫就会一边判定目录在外部、一边把仍在使用的目录删掉。这里单独钉住真实路径解析、
 * 缺失尾段的拼接与大小写折叠的适用范围。
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { comparableDirectory } = await jiti.import("./path-compare.ts");

/** 建一棵用完即删的临时目录树，返回真实路径（macOS 的 `/var` 链接也解析掉）。 */
function createTempRoot(t) {
	const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ompdesk-path-compare-")));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

/** 期望的比较键：真实路径，Windows 上再折叠大小写。 */
function expectedKey(absolute) {
	return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

/**
 * 目录符号链接是否可用：Windows 上普通用户默认建不出。探测只做一次，跳过给在注册
 * 选项上——Bun 的 node:test 实现里 `t.skip()` 会抛 NotImplementedError。
 */
function probeDirectorySymlinks() {
	const root = mkdtempSync(join(tmpdir(), "ompdesk-link-probe-"));
	try {
		mkdirSync(join(root, "target"));
		symlinkSync(join(root, "target"), join(root, "link"), process.platform === "win32" ? "junction" : "dir");
		return true;
	} catch (error) {
		const code = error?.code;
		if (code === "EPERM" || code === "EACCES" || code === "ENOSYS" || code === "ENOTSUP") return false;
		throw error;
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

const SYMLINKS_SUPPORTED = probeDirectorySymlinks();
const SYMLINK_SKIP_REASON = "Creating directory symlinks requires additional privileges on this platform";

/**
 * 卷是否大小写不敏感：建一个含大写字母的目录，再看全大写形态是否也指到它。大小写敏感的
 * 卷上这是两个目录，前提不成立，用例按注册期跳过。
 */
function probeCaseInsensitiveVolume() {
	const root = mkdtempSync(join(tmpdir(), "ompdesk-case-probe-"));
	try {
		mkdirSync(join(root, "Case-Probe"));
		return existsSync(join(root, "CASE-PROBE"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

const CASE_INSENSITIVE_VOLUME = probeCaseInsensitiveVolume();
const CASE_SKIP_REASON = "卷大小写敏感：大小写变体指向不同目录，前提不成立";

test("已存在的目录经符号链接归一到真实路径", { skip: SYMLINKS_SUPPORTED ? false : SYMLINK_SKIP_REASON }, (t) => {
	const root = createTempRoot(t);
	const target = join(root, "target");
	mkdirSync(target);
	const link = join(root, "link");
	symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");

	assert.equal(comparableDirectory(link), comparableDirectory(target));
});

test(
	"缺失的尾段拼在最近的已存在祖先之后，祖先里的符号链接同样解析",
	{ skip: SYMLINKS_SUPPORTED ? false : SYMLINK_SKIP_REASON },
	(t) => {
		// 整条路径解析失败就退回字面路径的话，祖先里的链接会漏掉：两侧一半真实路径一半
		// 字面路径，包含关系跟着漏判。
		const root = createTempRoot(t);
		const missingTail = join("missing-A", "missing-B");
		assert.equal(comparableDirectory(join(root, missingTail)), expectedKey(join(root, missingTail)));

		const target = join(root, "target");
		mkdirSync(target);
		const link = join(root, "link");
		symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
		assert.equal(comparableDirectory(join(link, missingTail)), expectedKey(join(target, missingTail)));
	},
);

test(
	"大小写不敏感卷上已存在目录的大小写变体得到同一比较键",
	{ skip: CASE_INSENSITIVE_VOLUME ? false : CASE_SKIP_REASON },
	(t) => {
		// 大小写折叠只加在 Windows 上，靠的是「已存在的路径由 native realpath 按磁盘写法归一」。
		// 缺了这条前提，macOS 上同一个目录的两种写法会得到不同的键，包含关系守卫跟着漏判。
		const root = createTempRoot(t);
		const directory = join(root, "Reports");
		mkdirSync(directory);

		assert.equal(comparableDirectory(join(root, "REPORTS")), comparableDirectory(directory));
		assert.equal(comparableDirectory(join(root, "reports")), comparableDirectory(directory));
	},
);

test("只在 Windows 上折叠比较键的大小写", (t) => {
	// macOS 默认大小写不敏感，已存在的路径由 native realpath 归一，大小写变体自己就会撞在
	// 一起（见上一个用例）；缺失的尾段再折叠，会在大小写敏感的卷上把 `Agent` 与 `agent`
	// 并成同一个键。
	const root = createTempRoot(t);
	const missing = join(root, "Missing-Dir");
	const key = comparableDirectory(missing);

	assert.equal(key, expectedKey(missing));
	if (process.platform !== "win32") {
		assert.notEqual(key, missing.toLowerCase(), "Windows 之外不得折叠大小写");
	}
});
