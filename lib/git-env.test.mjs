import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import {
  assertStrippedGitEnv,
  gitSubprocessCalls,
  mentionsGitLiteral,
  subprocessCallSiteLines,
} from "../test-support/git-env-guard.mjs";

const jiti = createJiti(import.meta.url);
const { createGitEnv, stripRepoLocationEnv, REPO_LOCATION_ENV_KEYS } = await jiti.import("./git-env.ts");

/**
 * 按大小写不敏感找出环境里匹配某个键名的实际键。Windows 上环境变量键名大小写
 * 不敏感、写进去的写法也不保证保留，只能这样比较。
 */
function envKeyIgnoringCase(env, expected) {
  return Object.keys(env).find((key) => key.toUpperCase() === expected.toUpperCase());
}

/** 断言 `env` 里每个键都按注入值存在，`context` 用于指明是哪一步的环境。 */
function assertEnvKeeps(env, expected, context) {
  for (const [key, value] of Object.entries(expected)) {
    const actualKey = envKeyIgnoringCase(env, key);
    assert.ok(actualKey, `${context} 中的 ${key} 必须存在`);
    assert.equal(env[actualKey], value, `${context} 中的 ${key} 必须保持注入值`);
  }
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
  // 注入没生效时用例读到的是空环境，剥离与保留都会「通过」，必须先证明注入落地。
  assertEnvKeeps(process.env, injected, "注入后");
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
    // 剥离只作用在返回的副本上：调用方进程自己的环境必须原样保留，否则一次调用
    // 就会污染同一进程里后续所有 git 调用。
    assertEnvKeeps(process.env, injected, "createGitEnv 调用后的 process.env");
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
  // 取舍：配置来源按调用方的受信任输入处理，一律保留（仓库定位键除外，见下面的过滤用例）；
  // 只剥离直接改变仓库定位与对象库的变量。这些变量承载调用方的 `safe.directory`、代理与
  // 证书设置，剥掉它们等于替调用方丢掉配置，所以清单必须留出它们。
  const parameters = "'safe.directory'='/repo' 'http.proxy'='http://proxy.test:8080'";
  const injected = {
    GIT_CONFIG: "caller-config",
    GIT_CONFIG_PARAMETERS: parameters,
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "safe.directory",
    GIT_CONFIG_VALUE_0: "/repo",
    GIT_CONFIG_KEY_1: "http.sslverify",
    GIT_CONFIG_VALUE_1: "false",
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

/** 取出副本里的某个变量值；`createGitEnv` 只是过滤，不该丢掉整个变量。 */
function envValue(env, key) {
  const actualKey = envKeyIgnoringCase(env, key);
  assert.ok(actualKey, `${key} 必须存在`);
  return env[actualKey];
}

test("GIT_CONFIG_PARAMETERS 里的仓库定位键被摘掉，其余条目原样保留", async () => {
  // 钩子经 `git -c core.worktree=<别处>` 调用时这条变量正带着取值：留着它，`-C` 定位到
  // 的仓库会被换成别处的工作区。过滤只删仓库定位键，其余条目连原文一起拼回。
  const injected = {
    GIT_CONFIG_PARAMETERS: [
      "'safe.directory'='/repo'",
      "'core.worktree'='D:\\work'",
      "'Core.Bare'='true'",
      "'http.proxy'='http://proxy.test:8080'",
      "'weird.name'='a'\\''b'",
      "'end.path'='end\\'",
      "'discovery.bare'",
    ].join(" "),
  };
  await withInjectedEnv(injected, () => {
    const env = createGitEnv();
    // 值不以反斜杠转义（git 只把单引号写成 `'\''`），`'end\'` 这种以反斜杠结尾的取值
    // 不能被当成转义而把后面的条目一起吞掉。
    assert.equal(
      envValue(env, "GIT_CONFIG_PARAMETERS"),
      "'safe.directory'='/repo' 'http.proxy'='http://proxy.test:8080' 'weird.name'='a'\\''b'" +
        " 'end.path'='end\\' 'discovery.bare'",
    );
    // 过滤只作用在返回的副本上：调用方进程自己的环境必须原样保留。
    assert.equal(envValue(process.env, "GIT_CONFIG_PARAMETERS"), injected.GIT_CONFIG_PARAMETERS);
  });
});

test("GIT_CONFIG_PARAMETERS 里只剩仓库定位键时该变量清空", async () => {
  const injected = { GIT_CONFIG_PARAMETERS: "'core.worktree'='/caller/checkout' 'core.bare'" };
  await withInjectedEnv(injected, () => {
    assert.equal(envValue(createGitEnv(), "GIT_CONFIG_PARAMETERS"), "");
  });
});

test("GIT_CONFIG_PARAMETERS 单段写法 `'键=值'` 的键名按第一个 `=` 切开", async () => {
  // git 按空白切段、去引号后在第一个 `=` 处切键：`'core.worktree=/elsewhere'` 的键是
  // `core.worktree`。整段当键名会让它漏过过滤，`-C` 之后的工作区仍被换掉。
  const injected = {
    GIT_CONFIG_PARAMETERS: [
      "'core.worktree=/elsewhere'",
      "'safe.directory=/repo'",
      "'http.proxy=http://proxy.test:8080?x=1'",
    ].join(" "),
  };
  await withInjectedEnv(injected, () => {
    assert.equal(
      envValue(createGitEnv(), "GIT_CONFIG_PARAMETERS"),
      "'safe.directory=/repo' 'http.proxy=http://proxy.test:8080?x=1'",
    );
  });
});

test("GIT_CONFIG_PARAMETERS 里的 `!` 按 git 的 `'\\!'` 转义读出，其余条目不被截断", async () => {
  // git 的 sq_quote_buf() 对段内 `'` 与 `!` 都输出 `'\X'`（后者避开 csh 的历史展开），
  // 下面的串照抄 git 的实际输出。只认 `'\''` 会把 `'\!'` 当成引号结束，接着读到反斜杠
  // 就解析失败，整条变量连调用方的 safe.directory 一起丢掉。
  const injected = {
    GIT_CONFIG_PARAMETERS: [
      "'safe.directory'='/repo'",
      "'probe.bang'='wow'\\!'x'",
      "'core.worktree'='/elsewhere'",
      "'probe.mixed'='a'\\''b'\\!''",
      "'core.worktree=/elsewhere'",
    ].join(" "),
  };
  await withInjectedEnv(injected, () => {
    assert.equal(
      envValue(createGitEnv(), "GIT_CONFIG_PARAMETERS"),
      "'safe.directory'='/repo' 'probe.bang'='wow'\\!'x' 'probe.mixed'='a'\\''b'\\!''",
    );
  });
});

test("GIT_CONFIG_PARAMETERS 格式读不懂时整条丢掉", async () => {
  // 少了引号的取值 git 自己也读不了；原样传下去等于放任里面可能藏着的仓库定位键。
  const injected = { GIT_CONFIG_PARAMETERS: "core.worktree=/work safe.directory=/repo" };
  await withInjectedEnv(injected, () => {
    assert.equal(envKeyIgnoringCase(createGitEnv(), "GIT_CONFIG_PARAMETERS"), undefined);
  });
});

test("大小写并存的 GIT_CONFIG_PARAMETERS 逐个变体过滤", () => {
  // git 只读精确大小写的 `GIT_CONFIG_PARAMETERS`，但另一份 `git_config_parameters`
  // 也在子进程的环境里：只过滤第一份，另一份里的 `core.worktree` 照样生效。Windows 的
  // 进程环境造不出两份只差大小写的变量，所以直接喂普通对象。
  const env = stripRepoLocationEnv({
    GIT_CONFIG_PARAMETERS: "'core.worktree'='/elsewhere' 'safe.directory'='/repo'",
    git_config_parameters: "'Core.Bare'='true' 'http.proxy'='http://proxy.test:8080'",
  });
  assert.equal(env.GIT_CONFIG_PARAMETERS, "'safe.directory'='/repo'");
  assert.equal(env.git_config_parameters, "'http.proxy'='http://proxy.test:8080'");
});

test("GIT_CONFIG_COUNT 三件套里的仓库定位键被摘掉并重排索引", async () => {
  // 键值按索引成对编号：删掉中间一条必须重排，否则 git 读到空号就报错。
  const injected = {
    GIT_CONFIG_COUNT: "4",
    GIT_CONFIG_KEY_0: "safe.directory",
    GIT_CONFIG_VALUE_0: "/repo",
    GIT_CONFIG_KEY_1: "core.worktree",
    GIT_CONFIG_VALUE_1: "D:\\work",
    GIT_CONFIG_KEY_2: "core.bare",
    GIT_CONFIG_VALUE_2: "true",
    GIT_CONFIG_KEY_3: "http.sslverify",
    GIT_CONFIG_VALUE_3: "false",
  };
  await withInjectedEnv(injected, () => {
    const env = createGitEnv();
    assert.equal(envValue(env, "GIT_CONFIG_COUNT"), "2");
    assert.equal(envValue(env, "GIT_CONFIG_KEY_0"), "safe.directory");
    assert.equal(envValue(env, "GIT_CONFIG_VALUE_0"), "/repo");
    assert.equal(envValue(env, "GIT_CONFIG_KEY_1"), "http.sslverify");
    assert.equal(envValue(env, "GIT_CONFIG_VALUE_1"), "false");
    // 重排后索引到该处为止，残留的高号键会被 git 当成多出来的配置。
    assert.equal(envKeyIgnoringCase(env, "GIT_CONFIG_KEY_2"), undefined);
    assert.equal(envKeyIgnoringCase(env, "GIT_CONFIG_VALUE_2"), undefined);
    assert.equal(envKeyIgnoringCase(env, "GIT_CONFIG_KEY_3"), undefined);
    assert.equal(envKeyIgnoringCase(env, "GIT_CONFIG_VALUE_3"), undefined);
  });
});

test("三件套只带仓库定位键时清空", async () => {
  const injected = {
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "core.worktree",
    GIT_CONFIG_VALUE_0: "/caller/checkout",
    GIT_CONFIG_KEY_1: "core.bare",
  };
  await withInjectedEnv(injected, () => {
    const env = createGitEnv();
    assert.equal(envValue(env, "GIT_CONFIG_COUNT"), "0");
    assert.equal(envKeyIgnoringCase(env, "GIT_CONFIG_KEY_0"), undefined);
    assert.equal(envKeyIgnoringCase(env, "GIT_CONFIG_VALUE_0"), undefined);
    assert.equal(envKeyIgnoringCase(env, "GIT_CONFIG_KEY_1"), undefined);
  });
});

test("三件套读不齐时整组丢掉", async () => {
  // `GIT_CONFIG_KEY_<n>` 缺号时读不到那几条的内容，里面可能正藏着 `core.worktree`：
  // 留着整组等于把它原样交给子进程，与 `GIT_CONFIG_PARAMETERS` 解析失败时整条丢掉的
  // fail-closed 口径不一致。
  const injected = {
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "safe.directory",
    GIT_CONFIG_VALUE_0: "/repo",
    GIT_CONFIG_KEY_2: "core.worktree",
    GIT_CONFIG_VALUE_2: "D:\\work",
  };
  await withInjectedEnv(injected, () => {
    const env = createGitEnv();
    for (const key of Object.keys(injected)) {
      assert.equal(envKeyIgnoringCase(env, key), undefined, `${key} 必须整组丢掉`);
    }
  });
});

test("GIT_CONFIG_COUNT 不是十进制整数时整组丢掉", async () => {
  // `Number.parseInt` 会把 `3abc` 读成 3、把 `1.5` 读成 1，于是按错的条数去读、再原样
  // 留着这条变量。count 读不懂时没法判断哪几条要摘，只能整组丢掉。
  for (const countText of ["3abc", "-1", " 2", "0x2", "1.5"]) {
    const injected = {
      GIT_CONFIG_COUNT: countText,
      GIT_CONFIG_KEY_0: "core.worktree",
      GIT_CONFIG_VALUE_0: "/caller/checkout",
    };
    await withInjectedEnv(injected, () => {
      const env = createGitEnv();
      for (const key of Object.keys(injected)) {
        assert.equal(
          envKeyIgnoringCase(env, key),
          undefined,
          `count=${JSON.stringify(countText)} 时 ${key} 必须整组丢掉`,
        );
      }
    });
  }
});

test("大小写并存的 GIT_CONFIG_COUNT 读不出实际生效的一组，整组丢掉", () => {
  // `GIT_CONFIG_COUNT` 与 `git_config_count` 并存时读不出 git 实际启用的是哪一组，
  // 逐组过滤会留下没检查过的条目：与读不齐时同一口径，整组丢掉。
  const env = stripRepoLocationEnv({
    GIT_CONFIG_COUNT: "1",
    git_config_count: "1",
    GIT_CONFIG_KEY_0: "safe.directory",
    GIT_CONFIG_VALUE_0: "/repo",
  });
  assert.deepEqual(Object.keys(env), [], "三件套整组丢掉，一条都不留");
});

test("同一索引的键或值出现大小写变体时整组丢掉", () => {
  // git 只读精确大小写的 `GIT_CONFIG_KEY_<n>`；两份并存时另一份里可能正藏着
  // `core.worktree`，读不齐就整组丢掉。
  const duplicatedKey = stripRepoLocationEnv({
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "safe.directory",
    git_config_key_0: "core.worktree",
  });
  assert.deepEqual(Object.keys(duplicatedKey), [], "重复的键名整组丢掉");

  const duplicatedValue = stripRepoLocationEnv({
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "safe.directory",
    GIT_CONFIG_VALUE_0: "/repo",
    git_config_value_0: "true",
  });
  assert.deepEqual(Object.keys(duplicatedValue), [], "重复的取值整组丢掉");
});

const REPO_ROOT = new URL("../", import.meta.url);
const REPO_ROOT_PATH = fileURLToPath(REPO_ROOT);
// 会发起 git 子进程的目录。lib 目前是全部调用点所在；app 的路由与 scripts 里的
// 脚本同样可能起 git，一并扫，日后加调用点不必先想起来改这里。
const GIT_CALL_DIRS = ["lib/", "app/", "scripts/"];
const SOURCE_FILE_RE = /\.(ts|tsx|mjs|cjs|js|jsx)$/;
const TEST_FILE_RE = /\.test\.(ts|tsx|mjs|cjs|js|jsx)$/;

/** 递归列出源码文件，跳过测试文件与 `node_modules`、`.next` 这类点号开头的产物目录。 */
function* sourceFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      yield* sourceFiles(new URL(`${entry.name}/`, directory));
      continue;
    }
    if (!SOURCE_FILE_RE.test(entry.name)) continue;
    if (TEST_FILE_RE.test(entry.name) || entry.name.endsWith(".d.ts")) continue;
    yield new URL(entry.name, directory);
  }
}

/**
 * 递归列出测试文件。测试会建临时仓库，钩子注入的 `GIT_DIR` 同样会盖过 `git init <目录>`
 * 与 `git -C <目录>`，所以测试里的 git 调用也要按生产侧的规则检查。
 */
function* testFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      yield* testFiles(new URL(`${entry.name}/`, directory));
      continue;
    }
    if (TEST_FILE_RE.test(entry.name)) yield new URL(entry.name, directory);
  }
}

/**
 * 收集扫描结果。先按字面量 `"git"` 筛掉不碰 git 的文件，再用 AST 定准调用。扫描器按首参
 * 认 git、不认函数名，换名字的包装也能扫到；把 `"git"` 先存进变量的调用它追不到。
 *
 * `sites` 是每个调用 git 子进程的模块，`sources` 保留原文供下面的交叉核对，`unscanned`
 * 是提到 `"git"` 却一条调用都没扫到的模块：预筛命中、AST 阶段扫不到的文件必须显式放行，
 * 不能静默跳过。`walk` 决定扫源码还是扫测试，`directories` 是扫描的根目录。
 */
function scanGitCallSites(walk = sourceFiles, directories = GIT_CALL_DIRS) {
  const sites = new Map();
  const sources = new Map();
  const unscanned = [];
  for (const directory of directories) {
    for (const file of walk(new URL(directory, REPO_ROOT))) {
      const source = readFileSync(file, "utf8");
      if (!mentionsGitLiteral(source)) continue;
      const label = path.relative(REPO_ROOT_PATH, fileURLToPath(file)).split(path.sep).join("/");
      sources.set(label, source);
      const calls = gitSubprocessCalls(source, label);
      if (calls.length > 0) sites.set(label, calls);
      else unscanned.push(label);
    }
  }
  return { sites, sources, unscanned };
}

/** 测试文件里的 git 调用：与生产侧同一批目录，按测试文件过滤。 */
const TEST_GIT_CALL_DIRS = [...GIT_CALL_DIRS, "test-support/"];

/**
 * 提到字面量 `"git"` 却不发起 git 子进程的模块。面板视图名这类非首参位置的值会让文本
 * 预筛命中、AST 阶段扫不到；新出现的文件要么修扫描器、要么进这份清单，不能静默放过。
 */
const GIT_LITERAL_WITHOUT_CALLS = ["lib/panel-tabs.ts"];

/**
 * 用 `-C <目录>` 或 `--git-dir` 定位仓库的模块：钩子注入的仓库变量会盖过这两种定位
 * 方式，所以每个调用都传 `createGitEnv()`。新增的调用点由扫描自动覆盖；这份清单钉住
 * 已知模块，扫描器认不出调用时直接失败，避免断言在空集上「通过」。
 */
const STRIPPED_GIT_ENV_MODULES = [
  "lib/git-changes.ts",
  "lib/git-ignore.ts",
  "lib/git-listing.ts",
  "lib/skill-updates.ts",
  "lib/worktree.ts",
];

test("每个 git 调用点都给子进程传了剥离后的环境", () => {
  const { sites, unscanned } = scanGitCallSites();

  assert.deepEqual(
    [...unscanned].sort(),
    [...GIT_LITERAL_WITHOUT_CALLS].sort(),
    "提到字面量 git 的文件除放行清单外都必须扫出调用",
  );
  for (const file of STRIPPED_GIT_ENV_MODULES) {
    assert.ok(sites.has(file), `${file} 应被扫描出 git 调用；扫不到说明扫描器失灵，逐调用断言会形同虚设`);
  }
  for (const [file, calls] of sites) {
    assertStrippedGitEnv(calls, file);
  }
});

/**
 * 已列模块的子进程调用点按入口清单再数一遍：扫描器只认首参字面量 `"git"`，把 `"git"`
 * 先存进变量的新调用扫不到，模块在不在清单里也挡不住。这些模块里的子进程调用全是 git，
 * 两份行号清单必须逐行相等。
 */
test("已列模块的子进程调用点全部被扫描到", () => {
  const { sites, sources } = scanGitCallSites();

  for (const file of STRIPPED_GIT_ENV_MODULES) {
    const source = sources.get(file);
    assert.ok(source !== undefined, `${file} 应被扫描，先按文本预筛提到字面量 "git"`);
    const scanned = (sites.get(file) ?? []).map(({ line }) => line).sort((a, b) => a - b);
    const subprocess = subprocessCallSiteLines(source, file).sort((a, b) => a - b);
    assert.deepEqual(scanned, subprocess, `${file} 的 git 调用点必须覆盖全部子进程调用点，差集说明有调用没被扫到`);
  }
});

/**
 * 提到字面量 `"git"` 却不发起 git 子进程的测试文件。守卫自己的用例把 `"git"` 写进断言
 * 文本，更新检查的用例把它写进接口路径，面板标签的用例把它存成面板名常量；覆盖率用例
 * 用子进程替身断言参数，同样不建真实进程。
 */
const TEST_GIT_LITERAL_WITHOUT_CALLS = [
  "lib/git-env.test.mjs",
  "lib/git-ignore.coverage.test.mjs",
  "lib/panel-tabs.test.mjs",
  "lib/skill-updates.test.mjs",
  "scripts/release.coverage.test.mjs",
];

/**
 * 必须扫出 git 调用的测试模块。覆盖率门禁的这两份测试会建临时仓库，钩子注入的 `GIT_DIR`
 * 曾让 `git add -A` 落到真实仓库的索引上；列在这里，扫描器失灵时直接失败，而不是在空集上
 * 空转。
 */
const TEST_GIT_CALL_MODULES = ["lib/coverage-gate/base-coverage.test.mjs", "lib/coverage-gate/git-repository.test.mjs"];

test("测试里的 git 调用同样给子进程传了剥离后的环境", () => {
  const { sites, sources, unscanned } = scanGitCallSites(testFiles, TEST_GIT_CALL_DIRS);

  assert.deepEqual(
    [...unscanned].sort(),
    [...TEST_GIT_LITERAL_WITHOUT_CALLS].sort(),
    "提到字面量 git 的测试文件除放行清单外都必须扫出调用",
  );
  for (const file of TEST_GIT_CALL_MODULES) {
    assert.ok(sites.has(file), `${file} 应被扫描出 git 调用；扫不到说明这条守卫形同虚设`);
    const scanned = (sites.get(file) ?? []).map(({ line }) => line).sort((a, b) => a - b);
    const subprocess = subprocessCallSiteLines(sources.get(file), file).sort((a, b) => a - b);
    assert.deepEqual(scanned, subprocess, `${file} 的 git 调用点必须覆盖全部子进程调用点，差集说明有调用没被扫到`);
  }
  // 每个调用都要有 options 字面量且带 env: createGitEnv()，漏写的调用在这里失败。
  for (const [file, calls] of sites) assertStrippedGitEnv(calls, file);
});
