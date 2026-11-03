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

/**
 * 注入若干变量，跑完用例连键名带值一起还原。
 *
 * `body` 可以是异步体：不 `await` 的话 `finally` 会先跑完还原，异步体才继续执行，
 * 用例后半段读到的就不是注入值了。
 */
async function withInjectedEnv(injected, body) {
  const saved = new Map(Object.keys(injected).map((key) => [key, process.env[key]]));
  Object.assign(process.env, injected);
  try {
    return await body();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("git 环境剥离清单里的全部仓库变量并保留其余变量", async () => {
  const injected = Object.fromEntries(REPO_LOCATION_ENV_KEYS.map((key) => [key, `injected-${key}`]));
  await withInjectedEnv(injected, () => {
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

test("小写与混合大小写的仓库变量同样被剥离", async () => {
  // git 在 Windows 上把 `Git_Dir` 与 `GIT_DIR` 当成同一个变量：只按原样键名删除会
  // 让这些写法残留下来继续盖过 `-C`。
  const injected = { Git_Dir: "injected-mixed-case", git_object_directory: "injected-lowercase" };
  await withInjectedEnv(injected, () => {
    const env = createGitEnv();
    for (const key of Object.keys(injected)) {
      assert.equal(envKeyIgnoringCase(env, key), undefined, `${key} 必须被剥离`);
    }
  });
});

test("配置来源与提交身份变量原样保留", async () => {
  // 取舍：配置来源按调用方的受信任输入处理，一律保留；只剥离直接改变仓库定位与
  // 对象库的变量。这些变量承载调用方的 `safe.directory`、代理与证书设置，剥掉它们
  // 等于替调用方丢掉配置，所以清单必须留出它们。
  const injected = {
    GIT_CONFIG: "caller-config",
    GIT_CONFIG_PARAMETERS: "'core.worktree'='/caller/checkout'",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "safe.directory",
    GIT_CONFIG_VALUE_0: "/repo",
    GIT_CONFIG_GLOBAL: "/caller/global-config",
    GIT_CONFIG_SYSTEM: "/caller/system-config",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Fixture Author",
    GIT_AUTHOR_EMAIL: "author@example.test",
    GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z",
    GIT_COMMITTER_NAME: "Fixture Committer",
    GIT_COMMITTER_EMAIL: "committer@example.test",
    GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z",
  };
  await withInjectedEnv(injected, () => {
    const env = createGitEnv();
    for (const [key, value] of Object.entries(injected)) {
      const actualKey = envKeyIgnoringCase(env, key);
      assert.ok(actualKey, `${key} 必须保留`);
      assert.equal(env[actualKey], value, `${key} 原样保留`);
    }
  });
});
