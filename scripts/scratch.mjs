/**
 * 新建一个自包含的临时任务目录。
 *
 * 用法：bun run scratch <名字> [用途]
 *
 * 目录建在当前工作区的 .tmp/ 下，随 .gitignore 排除。名字只允许小写字母、
 * 数字、点、下划线与连字符。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const [name, ...rest] = process.argv.slice(2);

if (!name) {
  console.error("用法：bun run scratch <名字> [用途]");
  process.exit(1);
}

if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
  console.error(`名字只能包含小写字母、数字、点、下划线与连字符：${name}`);
  process.exit(1);
}

const target = join(repoRoot, ".tmp", name);

if (existsSync(target)) {
  console.error(`目录已存在：${target}`);
  process.exit(1);
}

const purpose = rest.join(" ").trim() || "（待补充）";
const now = new Date();
const created = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, "0"),
  String(now.getDate()).padStart(2, "0"),
].join("-");

mkdirSync(target, { recursive: true });
writeFileSync(
  join(target, "README.md"),
  `# ${name}

用途：${purpose}

创建时间：${created}

本目录是一次性产物，整个目录可以删除，不影响仓库与构建。
`,
  "utf8",
);

console.log(target);
