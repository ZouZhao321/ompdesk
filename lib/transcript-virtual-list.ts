export interface VirtualTranscriptModel {
	/**
	 * 首屏定位：最后一条对齐到视口底部，长会话打开即见最新一轮；空列表停在顶部。
	 * 虚拟列表只在挂载时读它，之后条目增减不改起点。
	 */
	initialTopMostItemIndex: { index: number; align: "end" };
	/** 与条目一一对应的稳定键，顺序与条目数组一致。 */
	itemKeys: string[];
}

/** 列表只需要每项的键；分组条目与流式合成项都满足。 */
export interface TranscriptListItemKey {
	key: string;
}

/**
 * 虚拟列表要的两样东西：条目键与首屏定位。
 *
 * 键取一轮的锚点 entryId，条目滚出视野被卸载后重建仍是同一条；旧会话缺 id 时
 * 分组模块退回 `index-N`，万一仍撞车这里再补一次下标，列表不接受重复键。
 *
 * `liveTailKey` 是流式合成项固定追加在末尾的键。它的正文每个数据块都在变，键却
 * 不变，因此输入只需分组结果：流式期间键数组与首屏下标保持同一份。
 */
export function buildVirtualTranscriptModel(
	items: readonly TranscriptListItemKey[],
	liveTailKey: string | null = null,
): VirtualTranscriptModel {
	const bases = items.map((item, index) => item.key || `index-${index}`);
	if (liveTailKey !== null) bases.push(liveTailKey);
	const used = new Set<string>();
	const itemKeys: string[] = [];
	for (const base of bases) {
		let key = base;
		for (let suffix = 1; used.has(key); suffix += 1) key = `${base}#${suffix}`;
		used.add(key);
		itemKeys.push(key);
	}
	return {
		initialTopMostItemIndex: { index: Math.max(itemKeys.length - 1, 0), align: "end" },
		itemKeys,
	};
}

/**
 * 列表的跟随开关：用户上滚后关闭跟随，其余情况交给列表自己判断。
 *
 * `"auto"` 只在列表贴底时跟着新内容走；用户上滚后本就离开底部，但显式关掉
 * 跟随才能保证内容继续增长时不把视图拽回去。
 */
export function transcriptFollowOutput(autoFollowPaused: boolean): "auto" | false {
	return autoFollowPaused ? false : "auto";
}
