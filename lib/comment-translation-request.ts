/**
 * 生成请求的客户端与服务端共享规则：单次请求的条目上限，以及失败码到界面文案的映射。
 * 两边引用同一个上限，面板按它分批，服务端按它拒绝。
 */

/** 一次生成请求最多处理的词条数。 */
export const MAX_COMMENT_TRANSLATION_ENTRIES = 1_000;

/** 界面提示键；文案在 lib/i18n/messages 里。 */
export type CommentTranslationErrorKey =
  | "comments.noModel"
  | "comments.invalidEntries"
  | "comments.generateFailed";

/** 服务端的 code 映射成具体提示；未知失败统一走生成失败。 */
export function commentTranslationErrorKey(code: unknown): CommentTranslationErrorKey {
  switch (code) {
    case "no_model":
    case "model_unavailable":
      return "comments.noModel";
    case "invalid_entries":
      return "comments.invalidEntries";
    default:
      return "comments.generateFailed";
  }
}

/** 按请求上限切分勾选条目，保持原有顺序。 */
export function chunkCommentTranslationEntries<T>(entries: readonly T[]): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < entries.length; offset += MAX_COMMENT_TRANSLATION_ENTRIES) {
    chunks.push(entries.slice(offset, offset + MAX_COMMENT_TRANSLATION_ENTRIES));
  }
  return chunks;
}
