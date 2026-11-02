/**
 * git 子进程环境的共享定义。
 *
 * git 钩子里这些变量指向钩子所在仓库，会盖过 `git -C`：被调用的 git 把目标目录
 * 当成别处仓库的工作区，命令结果与目标目录无关。所有用 `-C <目录>` 定位仓库的
 * 调用都必须先摘掉这些变量，否则钩子里的测试会读到钩子仓库。
 */

/**
 * git 的仓库本地环境变量：指定仓库位置、索引、对象库与命名空间，钩子注入后会盖过
 * `git -C`。清单取自 git(1) 的 ENVIRONMENT VARIABLES 一节中与仓库绑定或与仓库发现相关
 * 的条目。测试直接引用本常量，增删条目不需要手抄第二份。
 *
 * `GIT_CEILING_DIRECTORIES` 与 `GIT_DISCOVERY_ACROSS_FILESYSTEM` 不指定仓库，但改变
 * `-C` 之后的仓库发现：前者让上溯提前停下，后者决定能否跨文件系统上溯，钩子里的取值
 * 同样会让命令找到别处仓库，所以一并剥离。
 *
 * `GIT_CONFIG_PARAMETERS` 是外层 git 传给子进程（包括钩子）的 `-c` 参数，`-c
 * core.worktree=<别处>` 一类取值会改掉仓库位置，同样剥离。
 *
 * 刻意保留的是配置来源与提交身份。`GIT_CONFIG` 与 `GIT_CONFIG_COUNT`（连同成对的
 * `GIT_CONFIG_KEY_<n>` / `GIT_CONFIG_VALUE_<n>`）由调用方显式提供，用来携带
 * `safe.directory`、代理与证书设置；`GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` /
 * `GIT_CONFIG_NOSYSTEM` 只换配置文件位置。它们都不改 `-C` 指向的仓库，剥离则会改变本
 * 模块之外所有 git 调用的行为。代价是这些来源里写了 `core.worktree` 仍会生效：调用方
 * 的配置按受信任输入处理，只摘掉钩子会注入的那几个变量。
 * `GIT_AUTHOR_*` / `GIT_COMMITTER_*` 只影响提交身份。
 */
export const REPO_LOCATION_ENV_KEYS: readonly string[] = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_QUARANTINE_PATH",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
  "GIT_CONFIG_PARAMETERS",
  "GIT_SHALLOW_FILE",
  "GIT_REPLACE_REF_BASE",
];

/** 同一份清单的查表形式：环境变量逐个键名都要比一次，数组线性查找不划算。 */
const REPO_LOCATION_ENV_KEY_FLAGS: Record<string, true> = Object.fromEntries(
  REPO_LOCATION_ENV_KEYS.map((key) => [key, true]),
);

/**
 * 构造 git 子进程环境：剥离仓库本地环境变量，并固定消息语言，让错误文本与系统语言无关。
 *
 * Windows 上环境变量的键名大小写不定，`git_dir` 与 `GIT_DIR` 是同一个变量：删除时按
 * 大写键名匹配，否则小写写法的变量会残留下来继续盖过 `-C`。
 */
export function createGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C" };
  for (const key of Object.keys(env)) {
    if (REPO_LOCATION_ENV_KEY_FLAGS[key.toUpperCase()]) delete env[key];
  }
  return env;
}
