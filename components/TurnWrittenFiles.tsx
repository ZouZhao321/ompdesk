"use client";

import { useI18n } from "@/hooks/useI18n";
import { getFileName } from "@/lib/file-paths";
import type { OpenFileOptions } from "@/lib/panel-tabs";
import { writtenFileLabels, type WrittenFile } from "@/lib/turn-written-files";
import { getFileIcon } from "./FileIcons";

/**
 * Lists the files a turn actually wrote, as buttons that open each one's diff
 * in the preview pane. Entries come from the turn's successful `write`/`edit`
 * tool calls — the reply text is never scanned for paths.
 */
export function TurnWrittenFiles({ files, onOpenFile }: {
  files: WrittenFile[];
  onOpenFile?: (filePath: string, options?: OpenFileOptions) => void;
}) {
  const { t } = useI18n();
  if (files.length === 0) return null;
  // 同名文件靠路径片段区分：触屏没有悬停，读屏也不能拿到两个相同标签。
  const labels = writtenFileLabels(files.map((file) => file.filePath));

  return (
    <div aria-label={t("chat.filesWritten")} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 6 }}>
      {files.map(({ filePath }, index) => {
        const name = getFileName(filePath);
        const label = labels[index] ?? name;
        return (
          <button
            key={filePath}
            type="button"
            className="file-chip-button"
            title={filePath}
            aria-label={t("chat.openWrittenFile", { name: label })}
            onClick={() => onOpenFile?.(filePath, { modeHint: "diff" })}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 8px",
              // 长文件名要收在容器内：按钮可以被压到行宽，名字用省略号收尾。
              // 不在按钮上写 minWidth，手机档的 44px 命中区来自样式表，内联值会压过它。
              maxWidth: "100%",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              color: "var(--text)",
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            {getFileIcon(name, 12)}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
