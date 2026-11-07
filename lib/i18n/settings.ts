/**
 * 把设置分组名转成稳定的 key 片段。
 * @param group 服务端返回的分组名
 * @returns 小写、连字符分隔的分组片段；空名称回退为 group
 */
export function groupSlug(group: string): string {
	return (
		group
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, "-")
			.replace(/^-+|-+$/g, "") || "group"
	);
}

/** 设置标签名的翻译 key。 */
export function settingTabKey(tab: string): string {
	return `settings.tab.${tab}`;
}

/** 设置分组标题的翻译 key。 */
export function settingGroupKey(tab: string, group: string): string {
	return `settings.group.${tab}.${groupSlug(group)}`;
}

/** 设置字段名称的翻译 key。 */
export function settingFieldLabelKey(path: string): string {
	return `settings.field.${path}.label`;
}

/** 设置字段说明的翻译 key。 */
export function settingFieldDescriptionKey(path: string): string {
	return `settings.field.${path}.description`;
}

/** 搜索时需要的字段形状。 */
export interface SettingSearchField {
	path: string;
	tab: string;
	group?: string;
}

/**
 * 按已解析的文案筛选设置字段。
 * @param fields 要筛选的字段
 * @param query 搜索词
 * @param text 把字段解析成显示文案
 * @returns 命中搜索词的字段
 */
export function filterSettingFieldsByQuery<T extends SettingSearchField>(
	fields: readonly T[],
	query: string,
	text: (field: T) => { label: string; description: string; group: string },
): T[] {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return [];
	return fields.filter((field) => {
		const display = text(field);
		return `${display.label} ${display.description} ${field.path} ${display.group}`
			.toLowerCase()
			.includes(normalized);
	});
}
