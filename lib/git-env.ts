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
 * 配置来源与提交身份一律保留。`GIT_CONFIG`、`GIT_CONFIG_PARAMETERS`（外层 git 传给
 * 子进程的 `-c` 参数）、`GIT_CONFIG_COUNT`（连同成对的 `GIT_CONFIG_KEY_<n>` /
 * `GIT_CONFIG_VALUE_<n>`）由调用方显式提供，用来携带 `safe.directory`、代理与证书设置；
 * `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` / `GIT_CONFIG_NOSYSTEM` 只换配置文件位置。
 * `GIT_AUTHOR_*` / `GIT_COMMITTER_*` 只影响提交身份。取舍是统一的：配置来源按调用方的
 * 受信任输入处理，一律保留，只剥离直接改变仓库定位与对象库的变量；剥掉其中任一种都会
 * 替调用方丢掉这些设置，并改变本模块之外所有 git 调用的行为。
 *
 * 例外是配置里能改变仓库定位的键（`REPO_LOCATION_CONFIG_KEYS`）：钩子经
 * `git -c core.worktree=<别处>` 调用时 `GIT_CONFIG_PARAMETERS` 正带着这种取值，`worktree
 * add/remove` 一类写操作就会落到别的仓库。这类键从 `GIT_CONFIG_PARAMETERS` 与
 * `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_<n>` / `GIT_CONFIG_VALUE_<n>` 三件套里摘掉，其余
 * 条目连原文一起保留。`GIT_CONFIG`（配置文件路径）只给路径，内容不读也不改。
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
  "GIT_SHALLOW_FILE",
  "GIT_REPLACE_REF_BASE",
];

/** 同一份清单的查表形式：环境变量逐个键名都要比一次，数组线性查找不划算。 */
const REPO_LOCATION_ENV_KEY_FLAGS: Record<string, true> = Object.fromEntries(
  REPO_LOCATION_ENV_KEYS.map((key) => [key, true]),
);

/**
 * 配置里能改变仓库定位的键。它们和上面那批环境变量做的是同一件事：`core.worktree` 换掉
 * 工作区、`core.bare` 把仓库当裸仓库，之后 `-C <目录>` 找到的仓库就不再是目标目录。
 * git 的配置键名大小写不敏感（`Core.WorkTree` 与 `core.worktree` 同一个键），比较时先
 * 转小写。
 */
export const REPO_LOCATION_CONFIG_KEYS: readonly string[] = ["core.worktree", "core.bare"];

/** 键名的比较口径：去掉两端空白后转小写，再查这份表。 */
const REPO_LOCATION_CONFIG_KEY_FLAGS: Record<string, true> = Object.fromEntries(
  REPO_LOCATION_CONFIG_KEYS.map((key) => [key, true]),
);

/** Windows 上的环境变量键名大小写不定，按大写找到实际的键名。 */
function findEnvKey(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const upperCaseName = name.toUpperCase();
  return Object.keys(env).find((key) => key.toUpperCase() === upperCaseName);
}

/**
 * 单引号段里的转义序列长度，`raw[index]` 处不认识转义时返回 0。git 的 `sq_quote_buf()`
 * 对段内两种字符输出 `'\X'`：字面单引号（`'\''`）与 `!`（`'\!'`，避开 csh 的历史展开），
 * `sq_dequote()` 也只认这两种。值里的反斜杠不参与转义（`'core.worktree'='D:\work'`
 * 就是这样传的），别把它当成通用的反斜杠转义。
 */
function quotedEscapeLength(raw: string, index: number): number {
  if (raw[index] !== "'" || raw[index + 1] !== "\\" || raw[index + 3] !== "'") return 0;
  const escaped = raw[index + 2];
  return escaped === "'" || escaped === "!" ? 4 : 0;
}

/**
 * 读一段 sq-quoted 文本，返回解出的内容与段落结束后的位置。`start` 处必须是开引号；
 * 引号没闭合时返回 null，交给调用方把整条变量丢掉。
 */
function readQuotedSegment(raw: string, start: number): { text: string; end: number } | null {
  if (raw[start] !== "'") return null;
  let text = "";
  let index = start + 1;
  while (index < raw.length) {
    const escape = quotedEscapeLength(raw, index);
    if (escape > 0) {
      text += raw[index + 2];
      index += escape;
      continue;
    }
    if (raw[index] === "'") return { text, end: index + 1 };
    text += raw[index];
    index += 1;
  }
  return null;
}

interface ConfigParameter {
  key: string;
  /** 该条参数在原始串里的起止位置：保留时按原文切片拼回，值不必解码再编码。 */
  start: number;
  end: number;
}

/**
 * 解析 `GIT_CONFIG_PARAMETERS`：条目以空格分隔，每条形如 `'键'='值'`、`'键=值'` 或
 * `'键'`（没有值表示布尔真）。格式认不出时返回 null。
 *
 * 两种带值写法在 git 里不是一回事：`'键'='值'` 拆成两段引号，键就是前一段的全部内容；
 * `'键=值'` 只有一段引号，git 去引号后在第一个 `=` 处切键，键名是 `=` 之前的部分。
 */
function parseConfigParameters(raw: string): ConfigParameter[] | null {
  const parameters: ConfigParameter[] = [];
  let index = 0;
  while (index < raw.length) {
    if (raw[index] === " ") {
      index += 1;
      continue;
    }
    const start = index;
    const key = readQuotedSegment(raw, index);
    if (!key) return null;
    index = key.end;
    if (raw[index] === "=") {
      const value = readQuotedSegment(raw, index + 1);
      if (!value) return null;
      index = value.end;
      parameters.push({ key: key.text, start, end: index });
      continue;
    }
    // 单段写法 `'键=值'`：`=` 落在引号里面，键名取去引号后第一个 `=` 之前的部分。
    // 写回仍用原切片，值不必解码再编码。
    const separator = key.text.indexOf("=");
    parameters.push({
      key: separator === -1 ? key.text : key.text.slice(0, separator),
      start,
      end: index,
    });
  }
  return parameters;
}

/**
 * 摘掉 `GIT_CONFIG_PARAMETERS` 里的仓库定位键，其余条目原样保留。返回 null 表示这条变量
 * 的格式 git 自己也读不了，调用方应当整条丢掉。
 */
function stripRepoLocationParameters(raw: string): string | null {
  const parameters = parseConfigParameters(raw);
  if (!parameters) return null;
  const kept = parameters.filter(
    (parameter) => REPO_LOCATION_CONFIG_KEY_FLAGS[parameter.key.trim().toLowerCase()] !== true,
  );
  if (kept.length === parameters.length) return raw;
  return kept.map((parameter) => raw.slice(parameter.start, parameter.end)).join(" ");
}

interface CountedConfigEntry {
  key: string;
  value: string | undefined;
}

/**
 * 收集 `GIT_CONFIG_COUNT` 三件套里的条目。`GIT_CONFIG_VALUE_<n>` 可以缺省（等于布尔真），
 * 但 `GIT_CONFIG_KEY_<n>` 缺一条就是调用方自己传坏了，返回 null 表示不动这段环境。
 */
function readCountedConfig(env: NodeJS.ProcessEnv, count: number): CountedConfigEntry[] | null {
  const entries: CountedConfigEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const keyName = findEnvKey(env, `GIT_CONFIG_KEY_${index}`);
    if (!keyName) return null;
    const valueName = findEnvKey(env, `GIT_CONFIG_VALUE_${index}`);
    entries.push({ key: env[keyName] ?? "", value: valueName ? env[valueName] : undefined });
  }
  return entries;
}

/**
 * 摘掉三件套里的仓库定位键。键与值成对按索引编号，删掉中间一条必须重排索引，否则
 * git 读到空号就报错。
 */
function stripRepoLocationCountedConfig(env: NodeJS.ProcessEnv): void {
  const countName = findEnvKey(env, "GIT_CONFIG_COUNT");
  if (!countName) return;
  const count = Number.parseInt(env[countName] ?? "", 10);
  if (!Number.isInteger(count) || count <= 0) return;

  const entries = readCountedConfig(env, count);
  if (!entries) return;
  const kept = entries.filter(
    (entry) => REPO_LOCATION_CONFIG_KEY_FLAGS[entry.key.trim().toLowerCase()] !== true,
  );
  if (kept.length === entries.length) return;

  for (const key of Object.keys(env)) {
    if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/i.test(key)) delete env[key];
  }
  kept.forEach((entry, index) => {
    env[`GIT_CONFIG_KEY_${index}`] = entry.key;
    if (entry.value !== undefined) env[`GIT_CONFIG_VALUE_${index}`] = entry.value;
  });
  env[countName] = String(kept.length);
}

/**
 * 构造 git 子进程环境：剥离仓库本地环境变量与仓库定位配置，并固定消息语言，让错误文本
 * 与系统语言无关。
 *
 * Windows 上环境变量的键名大小写不定，`git_dir` 与 `GIT_DIR` 是同一个变量：删除时按
 * 大写键名匹配，否则小写写法的变量会残留下来继续盖过 `-C`。配置来源变量同理。
 */
export function createGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C" };
  for (const key of Object.keys(env)) {
    if (REPO_LOCATION_ENV_KEY_FLAGS[key.toUpperCase()]) delete env[key];
  }

  const parametersName = findEnvKey(env, "GIT_CONFIG_PARAMETERS");
  if (parametersName) {
    const filtered = stripRepoLocationParameters(env[parametersName] ?? "");
    if (filtered === null) delete env[parametersName];
    else env[parametersName] = filtered;
  }
  stripRepoLocationCountedConfig(env);
  return env;
}
