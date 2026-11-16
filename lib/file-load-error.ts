import type { TranslationParams } from "./i18n/types";

/**
 * 目录列表失败在界面上要显示的文案。
 *
 * `key` 是 i18n 字典里的键；`params` 只在需要把状态码写进文案时出现。
 * 界面只按响应状态码分类，不匹配服务端返回的错误字符串。
 */
export interface FileLoadFailureMessage {
  key: string;
  params?: TranslationParams;
}

/** 目录列表请求的失败：带上 HTTP 状态码，界面据此决定文案。 */
export class FileListError extends Error {
  /** 响应状态码；请求没拿到响应（断连、响应不是 HTTP）时为 `null`。 */
  readonly status: number | null;

  constructor(status: number | null) {
    super(status === null ? "File list request failed" : `File list request failed (HTTP ${status})`);
    this.name = "FileListError";
    this.status = status;
  }
}

/**
 * 把一次目录列表失败翻成文案。
 *
 * `403` 是授权拒绝；其它状态码是服务端错误；拿不到状态码（连接中断、响应不是 HTTP、
 * 响应体不是 JSON）单独一类，用户才能分清是自己的权限问题、服务端问题，还是网络断了。
 *
 * @param error 取数函数抛出的异常
 * @returns 要显示的文案键与插值参数
 */
export function describeFileLoadFailure(error: unknown): FileLoadFailureMessage {
  const status = error instanceof FileListError ? error.status : null;
  if (status === 403) return { key: "files.unauthorized" };
  if (status === null) return { key: "files.loadFailedNetwork" };
  return { key: "files.loadFailed", params: { status } };
}
