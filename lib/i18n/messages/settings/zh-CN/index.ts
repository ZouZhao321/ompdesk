import { appearance } from "./appearance";
import { chromeAccess } from "./chrome-access";
import { chromeLogs } from "./chrome-logs";
import { chromeMcp } from "./chrome-mcp";
import { chromeShell } from "./chrome-shell";
import { chromeThemes } from "./chrome-themes";
import { contextMemoryShell } from "./context-memory-shell";
import { interactionTasks } from "./interaction-tasks";
import { modelProviders } from "./model-providers";
import { toolsFiles } from "./tools-files";

/**
 * 设置窗口简体中文文案的分片。每个标签一片，新增译文只改对应分片，
 * 避免多人在同一份语言包文件里改动。
 */
export const settingsZhParts: Record<string, Record<string, string>> = {
  appearance,
  modelProviders,
  interactionTasks,
  toolsFiles,
  contextMemoryShell,
  chromeShell,
  chromeThemes,
  chromeMcp,
  chromeAccess,
  chromeLogs,
};

export const settingsZhMessages: Record<string, string> = Object.assign(
  {},
  ...Object.values(settingsZhParts),
);
