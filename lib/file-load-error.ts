import type { TranslationParams } from "./i18n/types";

/**
 * 目录列表失败在界面上要显示的文案。
 *
 * `key` 是 i18n 字典里的键；`params` 只在需要把状态码写进文案时出现。
 * 界面只按响应状态码与失败原因分类，不匹配服务端返回的错误字符串。
 */
export interface FileLoadFailureMessage {
  key: string;
  params?: TranslationParams;
}

/**
 * 拿不到状态码时的失败原因：请求本身没发出去或连接中断，与响应体解析失败分开。
 */
type FileListFailureReason = "network" | "invalid-body";

/** 目录列表请求的失败：带上 HTTP 状态码或失败原因，界面据此决定文案。 */
export class FileListError extends Error {
  /** 响应状态码；请求没拿到响应（断连、响应不是 HTTP）时为 `null`。 */
  readonly status: number | null;
  /** `status` 为 `null` 时的失败原因。 */
  readonly reason: FileListFailureReason;

  constructor(status: number | null, reason: FileListFailureReason = "network") {
    super(status === null ? `File list request failed (${reason})` : `File list request failed (HTTP ${status})`);
    this.name = "FileListError";
    this.status = status;
    this.reason = reason;
  }
}

/**
 * 把一次目录列表失败翻成文案。
 *
 * `403` 是授权拒绝；其它状态码是服务端错误；连接中断与响应体解析失败各占一类，
 * 用户才能分清是自己的权限问题、服务端问题、网络断了，还是响应不可用。
 *
 * @param error 取数函数抛出的异常
 * @returns 要显示的文案键与插值参数
 */
export function describeFileLoadFailure(error: unknown): FileLoadFailureMessage {
  const status = error instanceof FileListError ? error.status : null;
  if (status === 403) return { key: "files.unauthorized" };
  if (status !== null) return { key: "files.loadFailed", params: { status } };
  if (error instanceof FileListError && error.reason === "invalid-body") return { key: "files.loadFailedInvalid" };
  return { key: "files.loadFailedNetwork" };
}
