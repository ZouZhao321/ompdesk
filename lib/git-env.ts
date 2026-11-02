/**
 * git 子进程环境的共享定义。
 *
 * git 钩子里这些变量指向钩子所在仓库，会盖过 `git -C`：被调用的 git 把目标目录
 * 当成别处仓库的工作区，命令结果与目标目录无关。所有用 `-C <目录>` 定位仓库的
 * 调用都必须先摘掉这些变量，否则钩子里的测试会读到钩子仓库。
 */

/** 指定仓库位置的环境变量，git 钩子会注入。 */
const REPO_LOCATION_ENV_KEYS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
];

/**
 * 构造 git 子进程环境：剥离仓库定位变量，并固定消息语言，让错误文本与系统语言无关。
 */
export function createGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C" };
  for (const key of REPO_LOCATION_ENV_KEYS) delete env[key];
  return env;
}
