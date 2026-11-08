import type { AssistantContentBlock, ToolResultMessage } from "./types";
import { resolveLocalFilePath } from "./file-links";
import { isEditToolName, isWriteToolName } from "./tool-names";

export interface WrittenFile {
  /** Resolved absolute path of a file this turn wrote. */
  filePath: string;
}

function isFileWritingToolName(toolName: string): boolean {
  return isWriteToolName(toolName) || isEditToolName(toolName);
}

function readToolPath(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  const value = input.file_path ?? input.path;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Collect the distinct files a single assistant turn actually wrote.
 *
 * Every entry is derived from a `write`/`edit` tool call whose result arrived
 * and did not error — never from the reply text. A path the assistant merely
 * mentions in prose is not evidence that any file was touched, so it is not a
 * source here; the tool call is the record of what happened.
 *
 * Paths are resolved against `cwd`, deduped, and kept in first-seen order.
 */
export function extractTurnWrittenFiles(
  content: AssistantContentBlock[],
  toolResults: Map<string, ToolResultMessage> | undefined,
  cwd?: string,
): WrittenFile[] {
  const seen = new Set<string>();
  const writtenFiles: WrittenFile[] = [];

  for (const block of content) {
    if (block.type !== "toolCall") continue;
    if (!isFileWritingToolName(block.toolName)) continue;

    // No result yet (still streaming) or the call failed — nothing was written.
    const result = toolResults?.get(block.toolCallId);
    if (!result || result.isError) continue;

    const rawPath = readToolPath(block.input);
    if (!rawPath) continue;

    // Tool arguments are filesystem paths, not hrefs: preserve characters such
    // as #, ?, and :digits that have special meaning in links and source refs.
    const filePath = resolveLocalFilePath(rawPath, cwd);
    if (!filePath) continue;

    if (seen.has(filePath)) continue;
    seen.add(filePath);
    writtenFiles.push({ filePath });
  }

  return writtenFiles;
}

/**
 * Display labels for a turn's written files, in the same order as the input.
 *
 * A bare file name is enough while it is unique in the turn. When two entries
 * share a name, each grows the shortest trailing path segments that tell them
 * apart, so the label carries the difference itself instead of relying on the
 * hover tooltip. Full paths stay the identity; only the visible text changes.
 */
export function writtenFileLabels(filePaths: string[]): string[] {
  const segments = filePaths.map((filePath) => splitPathSegments(filePath));
  return segments.map((parts, index) => {
    for (let depth = 1; depth <= parts.length; depth += 1) {
      const suffix = parts.slice(-depth).join("/");
      const unique = segments.every(
        (other, otherIndex) => otherIndex === index || other.slice(-depth).join("/") !== suffix,
      );
      if (unique) return suffix;
    }
    return parts.join("/");
  });
}

function splitPathSegments(filePath: string): string[] {
  return filePath
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean);
}
