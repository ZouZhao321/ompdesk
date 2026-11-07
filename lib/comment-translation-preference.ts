/** 编辑器与面板共用的注释译文开关存储键。 */
export const COMMENT_TRANSLATION_STORAGE_KEY = "ompdesk:comment-translation";

let enabled = false;
let initialized = false;
const listeners = new Set<() => void>();

function readStored(): boolean {
	try {
		return window.localStorage.getItem(COMMENT_TRANSLATION_STORAGE_KEY) === "on";
	} catch {
		// 隐私模式下存储不可用，沿用默认关闭。
		return false;
	}
}

/**
 * 开关状态。首次读取时才访问 localStorage，服务端渲染与测试环境保持默认关闭。
 */
export function getCommentTranslationPreference(): boolean {
	if (!initialized) {
		enabled = readStored();
		initialized = true;
	}
	return enabled;
}

/** 写入开关状态；同一页面里的查看器与面板预览通过订阅同步。 */
export function setCommentTranslationPreference(next: boolean): void {
	enabled = next;
	initialized = true;
	try {
		window.localStorage.setItem(COMMENT_TRANSLATION_STORAGE_KEY, next ? "on" : "off");
	} catch {
		// 存储失败只影响下次打开页面时的默认值。
	}
	for (const listener of [...listeners]) listener();
}

export function subscribeCommentTranslationPreference(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
