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

/**
 * 把一次目录列表失败的状态码翻成文案。
 *
 * `403` 是授权拒绝；其它数字是服务端错误；没有状态码（连接中断、响应不是 HTTP）
 * 单独一类，用户才能分清是自己的权限问题、服务端问题，还是网络断了。
 *
 * @param status HTTP 状态码，请求没拿到响应时为 `null`
 * @returns 要显示的文案键与插值参数
 */
export function describeFileLoadFailure(status: number | null): FileLoadFailureMessage {
  if (status === 403) return { key: "files.unauthorized" };
  if (status === null) return { key: "files.loadFailedNetwork" };
  return { key: "files.loadFailed", params: { status } };
}
