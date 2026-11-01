import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  commentTranslationKey,
  commentTranslationKeys,
  commentTranslationRows,
  commentTranslationTarget,
} = await jiti.import("./comment-translation-render.ts");
const { commentEntryKey, extractCommentEntries } = await jiti.import("./comment-entries.ts");

const SOURCE = [
  "// 读取配置并返回结果",
  "// 连续的第二行说明",
  "const a = 1;",
].join("\n");

function entriesOf(content) {
  return extractCommentEntries([{ path: "src/demo.ts", content }]).entries;
}

function translated(entries, targetLanguage, text = "Reads the config") {
  return Object.fromEntries(entries.map((entry) => {
    const key = commentTranslationKey(entry, targetLanguage);
    return [key, text];
  }));
}

test("界面语言决定译文目标语言", () => {
  assert.equal(commentTranslationTarget("zh-CN"), "zh");
  assert.equal(commentTranslationTarget("en"), "en");
});

test("开关关闭时没有任何译文行，调用方可以原样显示源码", () => {
  const entries = entriesOf(SOURCE);
  const rows = commentTranslationRows({
    entries,
    translations: translated(entries, "zh"),
    targetLanguage: "zh",
    enabled: false,
  });

  assert.equal(rows.size, 0);
});

test("开启后译文挂在注释结束行，不新增行号", () => {
  const entries = entriesOf(SOURCE);
  const lineCount = SOURCE.split("\n").length;
  const rows = commentTranslationRows({
    entries,
    translations: translated(entries, "en"),
    targetLanguage: "en",
    enabled: true,
  });

  assert.deepEqual([...rows.keys()], [2]);
  for (const line of rows.keys()) {
    assert.ok(line >= 1 && line <= lineCount);
  }
  // 译文数量与行数无关：两行注释只产生一行译文，行号上限不变。
  assert.equal(rows.size, 1);
});

test("原文语言与目标语言相同的词条不查字典也不显示译文", () => {
  const content = ["// 第一条中文说明", "const a = 1;", "// 第二条中文说明", "const b = 2;"].join("\n");
  const entries = entriesOf(content);
  assert.deepEqual(entries.map((entry) => entry.language), ["zh", "zh"]);

  const rows = commentTranslationRows({
    entries,
    translations: Object.fromEntries(entries.map((entry) => [commentEntryKey(entry.text, "zh"), "同样语言的译文"])),
    targetLanguage: "zh",
    enabled: true,
  });

  assert.equal(rows.size, 0);
  assert.equal(commentTranslationKey(entries[0], "zh"), null);
  assert.deepEqual(commentTranslationKeys(entries, "zh"), []);
});

test("字典更新后重新计算，渲染无需重新加载源码", () => {
  const entries = entriesOf(SOURCE);
  const options = { entries, targetLanguage: "en", enabled: true };

  const before = commentTranslationRows({ ...options, translations: translated(entries, "en", "Old text") });
  const after = commentTranslationRows({ ...options, translations: translated(entries, "en", "New text") });

  assert.equal(before.get(2), "Old text");
  assert.equal(after.get(2), "New text");
});

test("查询键按目标语言去重，同一段注释只查一次", () => {
  const content = ["// Same note", "const a = 1;", "// Same note", "const b = 2;"].join("\n");
  const entries = entriesOf(content);
  const keys = commentTranslationKeys(entries, "zh");

  assert.deepEqual(keys, [commentEntryKey("Same note", "zh")]);
});
