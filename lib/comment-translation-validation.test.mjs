import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
	alias: { "@": process.cwd() },
	interopDefault: true,
	moduleCache: false,
});
const { protectedFragments, validateTranslation } = await jiti.import("./comment-translation-validation.ts");

test("译文逐字保留路径、标识符、数字与括号片段时通过", () => {
	const original = "把 app/api/route.ts 里的 completeSimple 超时设为 30000 毫秒（见 lib/omp-runtime.ts）";
	const translation = "Set the completeSimple timeout in app/api/route.ts to 30000 ms (see lib/omp-runtime.ts)";

	const result = validateTranslation(original, translation);
	assert.deepEqual(result.missing, []);
	assert.equal(result.ok, true);
});

test("译文丢掉路径时判失败并指出缺失的路径", () => {
	const original = "把 app/api/route.ts 里的超时设为 30000 毫秒";
	const translation = "Set the timeout to 30000 ms";

	const result = validateTranslation(original, translation);
	assert.equal(result.ok, false);
	assert.deepEqual(result.missing, [{ kind: "path", value: "app/api/route.ts" }]);
});

test("译文丢掉标识符时判失败", () => {
	const original = "completeSimple 返回 AssistantMessage";
	const translation = "It returns a message";

	const result = validateTranslation(original, translation);
	assert.equal(result.ok, false);
	assert.deepEqual(
		result.missing.map((fragment) => fragment.value),
		["completeSimple", "AssistantMessage"],
	);
});

test("译文丢掉数字时判失败", () => {
	const original = "重试 3 次，间隔 1.5 秒";
	const translation = "Retry a few times with a delay";

	const result = validateTranslation(original, translation);
	assert.equal(result.ok, false);
	assert.deepEqual(result.missing, [
		{ kind: "number", value: "3" },
		{ kind: "number", value: "1.5" },
	]);
});

test("括号片段被改写时判失败", () => {
	const original = "保存到目标目录 (见 config/app.yml)";
	const translation = "Save it to the target directory, see config/app.yml";

	const result = validateTranslation(original, translation);
	assert.equal(result.ok, false);
	assert.deepEqual(result.missing, [{ kind: "brackets", value: "(见 config/app.yml)" }]);
});

test("普通英文单词与缩写不要求逐字保留", () => {
	const original = "The parser reads the file, e.g. the first line.";
	const translation = "解析器读取文件，例如第一行。";

	assert.deepEqual(protectedFragments(original), []);
	assert.equal(validateTranslation(original, translation).ok, true);
});

test("空译文判失败并列出全部片段", () => {
	const result = validateTranslation("读取 route.ts", "   ");
	assert.equal(result.ok, false);
	assert.deepEqual(result.missing, [{ kind: "path", value: "route.ts" }]);
});

test("同一片段在原文出现多次时只要求一次", () => {
	const fragments = protectedFragments("camelCase 和 camelCase 都要保留");
	assert.deepEqual(fragments, [{ kind: "identifier", value: "camelCase" }]);
});
