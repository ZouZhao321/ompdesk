export interface ParsedCompactionSummary {
  body: string;
  readFiles: string[];
  modifiedFiles: string[];
}

const FILE_SECTION_RE = /<(read-files|modified-files)>\s*([\s\S]*?)\s*<\/\1>/g;
const FILE_SECTION_OPEN_RE = /^[ \t]*<(read-files|modified-files)>[ \t]*\r?$/;
const FILE_SECTION_CLOSE_RE = /^[ \t]*<\/(read-files|modified-files)>[ \t]*\r?$/;

/**
 * 找结尾元数据块的起始行号：从最后一个非空行向前，每个块必须由同名结束标签收尾，
 * 并能在上方找到对应的开始标签；块之间允许空行。
 */
function trailingMetadataLine(lines: string[]): number | undefined {
  let index = lines.length - 1;
  while (index >= 0 && lines[index].trim() === "") index--;
  if (index < 0) return undefined;

  let start: number | undefined;
  while (index >= 0) {
    const close = FILE_SECTION_CLOSE_RE.exec(lines[index]);
    if (!close) break;
    const name = close[1];
    let open = index - 1;
    while (open >= 0 && !FILE_SECTION_OPEN_RE.test(lines[open])) open--;
    const openMatch = open >= 0 ? FILE_SECTION_OPEN_RE.exec(lines[open]) : null;
    if (!openMatch || openMatch[1] !== name) return undefined;
    start = open;
    index = open - 1;
    while (index >= 0 && lines[index].trim() === "") index--;
  }

  if (start === undefined || start < 2 || lines[start - 1].trim() !== "") return undefined;
  return start;
}

export function parseCompactionSummary(summary: string): ParsedCompactionSummary {
  const readFiles: string[] = [];
  const modifiedFiles: string[] = [];
  const lines = summary.split("\n");
  const metadataLine = trailingMetadataLine(lines);
  const metadataBlock = metadataLine === undefined ? "" : lines.slice(metadataLine).join("\n");
  const body = metadataLine === undefined ? summary : lines.slice(0, metadataLine).join("\n");

  metadataBlock.replace(FILE_SECTION_RE, (_match, section: string, content: string) => {
    const files = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (section === "read-files") readFiles.push(...files);
    else modifiedFiles.push(...files);

    return "";
  });

  return {
    body: body.trim(),
    readFiles,
    modifiedFiles,
  };
}
