import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createGitEnv, REPO_LOCATION_ENV_KEYS } = await jiti.import("./git-env.ts");

/**
 * 按大小写不敏感找出环境里匹配某个键名的实际键。Windows 上环境变量键名大小写
 * 不敏感、写进去的写法也不保证保留，只能这样比较。
 */
function envKeyIgnoringCase(env, expected) {
  return Object.keys(env).find((key) => key.toUpperCase() === expected.toUpperCase());
}

/** 注入若干变量，跑完用例连键名带值一起还原。 */
function withInjectedEnv(injected, body) {
  const saved = new Map(Object.keys(injected).map((key) => [key, process.env[key]]));
  Object.assign(process.env, injected);
  try {
    return body();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("git 环境剥离清单里的全部仓库变量并保留其余变量", () => {
  const injected = Object.fromEntries(REPO_LOCATION_ENV_KEYS.map((key) => [key, `injected-${key}`]));
  withInjectedEnv(injected, () => {
    const env = createGitEnv();
    for (const key of REPO_LOCATION_ENV_KEYS) {
      assert.equal(envKeyIgnoringCase(env, key), undefined, `${key} 必须被剥离`);
    }
    assert.equal(env.LC_ALL, "C", "消息语言固定为 C");
    const pathKey = envKeyIgnoringCase(env, "PATH");
    assert.ok(pathKey, "其余变量必须原样保留，包括 PATH");
    assert.equal(env[pathKey], process.env[pathKey], "其余变量原样保留");
  });
});

test("小写与混合大小写的仓库变量同样被剥离", () => {
  // git 在 Windows 上把 `Git_Dir` 与 `GIT_DIR` 当成同一个变量：只按原样键名删除会
  // 让这些写法残留下来继续盖过 `-C`。
  const injected = { Git_Dir: "injected-mixed-case", git_config_parameters: "injected-lowercase" };
  withInjectedEnv(injected, () => {
    const env = createGitEnv();
    for (const key of Object.keys(injected)) {
      assert.equal(envKeyIgnoringCase(env, key), undefined, `${key} 必须被剥离`);
    }
  });
});
