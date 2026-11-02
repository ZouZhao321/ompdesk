import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createGitEnv } = await jiti.import("./git-env.ts");

const REPO_LOCATION_KEYS = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX"];

test("git 环境剥离钩子注入的仓库定位变量并保留其余变量", () => {
  const previous = new Map(REPO_LOCATION_KEYS.map((key) => [key, process.env[key]]));
  for (const key of REPO_LOCATION_KEYS) process.env[key] = `injected-${key}`;
  try {
    const env = createGitEnv();
    for (const key of REPO_LOCATION_KEYS) assert.equal(env[key], undefined, `${key} 必须被剥离`);
    assert.equal(env.LC_ALL, "C", "消息语言固定为 C");
    // Windows 上 process.env 的键名常是 Path：按大小写不敏感找到实际的键再比较。
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH");
    assert.ok(pathKey, "其余变量必须原样保留，包括 PATH");
    assert.equal(env[pathKey], process.env[pathKey], "其余变量原样保留");
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
