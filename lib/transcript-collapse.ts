/**
 * 会话转写是否折叠压缩前的历史，按会话所属目录读设置。
 *
 * 这是展示项。读设置失败时按不折叠处理并记一条日志：会话读取路径不能因为
 * `agent.db` 被锁或项目配置损坏而整条返回 500，那会连会话本身都打不开。
 */
import { logEvent } from "./logging";
import { getSettingsForCwd } from "./omp-runtime";
import { getSettingForWeb } from "./omp-settings";

export async function shouldCollapseCompactedHistory(cwd: string | undefined): Promise<boolean> {
  try {
    const settings = await getSettingsForCwd(cwd);
    return getSettingForWeb(settings, "display.collapseCompacted") === true;
  } catch (error) {
    logEvent("warn", "system", "settings.collapse_compacted.read_failed", {
      cwd,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
