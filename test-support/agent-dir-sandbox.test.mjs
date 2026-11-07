/**
 * 沙箱建目录的边界测试。
 *
 * 两个边界都不该被当成环境限制：子目录写出沙箱外是调用方写错，静默跳过会让用例消失；
 * 建目录中途失败留下的临时目录没人认领，只能在这一步回收。
 */
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { SandboxDirectoryCreateError, createAgentDirSandbox } = await jiti.import("./agent-dir-sandbox.ts");

/** `createAgentDirSandbox` 只用到 `after`；建目录阶段失败时它不该被调用。 */
const unusedContext = {
	after() {
		throw new Error("建目录失败时不该注册清理回调");
	},
};

/** 临时目录里属于某个用例前缀的条目，用来确认失败的沙箱没留下垃圾。 */
function sandboxEntries(prefix) {
	return readdirSync(tmpdir()).filter((entry) => entry.startsWith(prefix));
}

test("写出沙箱的子目录按代码错误抛出，且不建临时目录", () => {
	const prefix = "ompdesk-sandbox-fragment-";
	// 绝对路径与 `..` 片段都会把目录建到沙箱之外：删沙箱删不掉它，用例还会把数据写进
	// 真实目录。写错是调用方代码的问题，必须抛普通错误——包成
	// `SandboxDirectoryCreateError` 会被告成环境限制而静默跳过用例。
	const outsideSandbox = ["..", "../outside", "fixtures/../../outside", process.cwd()];
	for (const dir of outsideSandbox) {
		assert.throws(
			() => createAgentDirSandbox(unusedContext, { prefix, dirs: [dir] }),
			(error) =>
				error instanceof Error &&
				!(error instanceof SandboxDirectoryCreateError) &&
				error.message.includes("沙箱内的相对路径"),
			`${dir} 必须被拒绝`,
		);
	}
	assert.deepEqual(sandboxEntries(prefix), [], "校验发生在建临时目录之前");
});

test("铺子目录失败时回收已建好的临时目录", () => {
	const prefix = "ompdesk-sandbox-cleanup-";
	// 单段 300 字符超出文件系统的名字上限：`mkdtempSync` 先成功、`mkdirSync` 再失败，
	// 此时 `t.after` 还没注册，临时目录只能在这一步删掉。
	const tooLongForFileSystem = "x".repeat(300);
	assert.throws(
		() => createAgentDirSandbox(unusedContext, { prefix, dirs: [tooLongForFileSystem] }),
		(error) => error instanceof SandboxDirectoryCreateError,
		"建目录失败仍按环境限制报错",
	);
	assert.deepEqual(sandboxEntries(prefix), [], "失败的沙箱不能留下临时目录");
});
