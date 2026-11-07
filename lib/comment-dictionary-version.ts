/**
 * 字典版本：面板保存或删除译文后递增，查看器据此重新拉取译文，
 * 当前打开的文件不需要重新加载。
 */
let version = 0;
const listeners = new Set<() => void>();

export function getCommentDictionaryVersion(): number {
	return version;
}

export function notifyCommentDictionaryChanged(): void {
	version += 1;
	for (const listener of [...listeners]) listener();
}

export function subscribeCommentDictionary(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
