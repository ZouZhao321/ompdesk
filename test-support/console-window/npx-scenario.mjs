/**
 * 场景：npx 调用与更新类命令构建。
 *
 * 三条真实路径各查一遍，全程不装包、不联网：
 * - `runNpx` 真跑一次 `npx --version`，断言退出码与输出；
 * - `getSafeNpxEnv` / `redactNpxOutput` 是 npx 调用的凭据边界，一并核对；
 * - `buildInstallPlan` 只构建命令形态，不执行安装；
 * - `buildSkillUpdateArgs` 只构建参数数组，技能检查的联网部分不碰。
 *
 * 任何一步不符合预期都抛错，由被测进程入口写进结果文件。
 */
import path from "node:path";
import { createJiti } from "jiti";

/** 场景环境里注入的假凭据：名字命中敏感规则，值要足够长才会被判成需要脱敏。 */
const FAKE_SECRET_NAME = "OMPDESK_FAKE_API_KEY";
const FAKE_SECRET_VALUE = "sk-fake-console-window-fixture-0123456789";

export async function run() {
  const root = path.join(import.meta.dir, "..", "..");
  const jiti = createJiti(import.meta.url);
  const npx = await jiti.import(path.join(root, "lib", "npx.ts"));
  const { buildInstallPlan } = await jiti.import(path.join(root, "lib", "omp-updates.ts"));
  const { buildSkillUpdateArgs } = await jiti.import(path.join(root, "lib", "skill-updates.ts"));

  await checkNpxVersion(npx.runNpx);
  checkCredentialsWithheld(npx.getSafeNpxEnv, npx.redactNpxOutput);
  checkInstallPlan(buildInstallPlan);
  checkSkillUpdateArgs(buildSkillUpdateArgs);
}

/** `npx --version` 是纯本地调用：成功时退出码为 0，stdout 是版本号。 */
async function checkNpxVersion(runNpx) {
  const result = await runNpx(["--version"], { timeout: 60_000 });
  if (!result || typeof result.stdout !== "string" || typeof result.stderr !== "string")
    throw new Error(`npx 结果形态不符合预期：${JSON.stringify(result)}`);
  const version = result.stdout.trim();
  if (!/^\d+\.\d+\.\d+/.test(version))
    throw new Error(`npx --version 没有输出版本号：stdout=${JSON.stringify(result.stdout)}`);
}

/** 传给 npx 的环境必须去掉凭据，输出里的凭据必须被替换。 */
function checkCredentialsWithheld(getSafeNpxEnv, redactNpxOutput) {
  if (process.env[FAKE_SECRET_NAME] !== FAKE_SECRET_VALUE) throw new Error(`场景环境没有带上 ${FAKE_SECRET_NAME}`);
  const safe = getSafeNpxEnv({ FORCE_COLOR: "0" });
  if (FAKE_SECRET_NAME in safe) throw new Error(`凭据没有被摘掉：${FAKE_SECRET_NAME} 仍在 npx 环境里`);
  if (safe.FORCE_COLOR !== "0") throw new Error("显式传入的非敏感变量没有生效");

  const redacted = redactNpxOutput(`OMPDESK_FAKE_API_KEY=${FAKE_SECRET_VALUE}\nBearer ${FAKE_SECRET_VALUE}`);
  if (redacted.includes(FAKE_SECRET_VALUE)) throw new Error(`输出没有被脱敏：${JSON.stringify(redacted)}`);
}

/** 更新命令只构建不执行：断言它是当前平台的全局安装形态。 */
function checkInstallPlan(buildInstallPlan) {
  const bunPlan = buildInstallPlan({
    currentAppVersion: "0.1.0",
    latestPackage: { version: "0.2.0" },
    env: {},
  });
  if (bunPlan.manager !== "bun") throw new Error(`默认管理器不是 bun：${bunPlan.manager}`);
  if (bunPlan.command !== "bun add --global ompdesk@latest")
    throw new Error(`bun 全局安装命令不符合预期：${bunPlan.command}`);
  if (bunPlan.alternateCommand !== "npm install --global ompdesk@latest")
    throw new Error(`备用命令不符合预期：${bunPlan.alternateCommand}`);
  if (bunPlan.canInstall !== true || bunPlan.restartRequired !== true)
    throw new Error(`可安装时的计划不符合预期：${JSON.stringify(bunPlan)}`);
  if (bunPlan.reason !== undefined) throw new Error(`可安装时不应给出原因：${bunPlan.reason}`);

  const npmPlan = buildInstallPlan({
    currentAppVersion: "0.1.0",
    latestPackage: { version: "0.2.0" },
    env: { OMPDESK_UPDATE_MANAGER: "npm" },
  });
  if (npmPlan.manager !== "npm") throw new Error(`管理器的显式选择没有生效：${npmPlan.manager}`);
  if (npmPlan.command !== "npm install --global ompdesk@latest")
    throw new Error(`npm 全局安装命令不符合预期：${npmPlan.command}`);

  const upToDate = buildInstallPlan({ currentAppVersion: "0.2.0", latestPackage: { version: "0.2.0" }, env: {} });
  if (upToDate.canInstall !== false) throw new Error("已是最新版本时不应允许安装");

  const disabled = buildInstallPlan({
    currentAppVersion: "0.1.0",
    latestPackage: { version: "0.2.0" },
    env: { OMPDESK_DISABLE_SELF_UPDATE: "1" },
  });
  if (disabled.canInstall !== false) throw new Error("关闭自更新后仍然允许安装");
  if (disabled.reason !== "disabled") throw new Error(`关闭自更新后原因应为 disabled：${disabled.reason}`);
}

/** 技能更新命令同样由 npx 执行，只在这里断言参数形态。 */
function checkSkillUpdateArgs(buildSkillUpdateArgs) {
  const install = {
    package: "owner/skills@code-review",
    source: "owner/skills",
    skillPath: "skills/code-review/SKILL.md",
    ref: "main",
    versionHash: "abc123",
    canCheckForUpdates: true,
  };

  const globalArgs = buildSkillUpdateArgs({ ...install, scope: "global" });
  if (globalArgs[0] !== "skills" || globalArgs[1] !== "add")
    throw new Error(`技能更新子命令不符合预期：${JSON.stringify(globalArgs.slice(0, 2))}`);
  const target = globalArgs[2];
  if (target !== "owner/skills/skills/code-review#main") throw new Error(`技能源与目录拼接不符合预期：${target}`);
  const skillAt = globalArgs.indexOf("--skill");
  if (skillAt < 0 || globalArgs[skillAt + 1] !== "code-review")
    throw new Error(`技能名参数不符合预期：${JSON.stringify(globalArgs)}`);
  if (!globalArgs.includes("-y") || !globalArgs.includes("--agent"))
    throw new Error(`非交互与 agent 参数不符合预期：${JSON.stringify(globalArgs)}`);
  if (globalArgs[globalArgs.length - 1] !== "-g")
    throw new Error(`全局安装标志不符合预期：${JSON.stringify(globalArgs)}`);

  const projectArgs = buildSkillUpdateArgs({ ...install, scope: "project" });
  if (projectArgs.includes("-g")) throw new Error(`项目级技能不应带全局标志：${JSON.stringify(projectArgs)}`);
  if (projectArgs[2] !== "owner/skills/skills/code-review#main")
    throw new Error(`项目级技能源不符合预期：${projectArgs[2]}`);
}
