/** 侧边栏项目行的排序方式：按最近活动时间，或按工作目录名称。 */
export type ProjectSortMode = "time" | "name";

/**
 * 项目键：把 Windows 反斜杠统一成 /，并折叠盘符路径的大小写。
 * POSIX 路径保持原样，因为大小写不同可能是两个不同的目录。
 */
export function normalizeProjectKey(project: string): string {
  const normalized = project.replace(/\\/g, "/");
  return /^[a-zA-Z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

/** 项目分组的显示名：工作目录最后一段，忽略结尾的分隔符。 */
export function projectDisplayName(project: string): string {
  const segments = project.replace(/[\\/]+$/, "").split(/[\\/]/);
  return segments.at(-1) || project;
}

// 显示名比较忽略大小写与数字写法差异；同名时改用完整路径的码元顺序，结果只取决于输入。
const projectNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * 项目行顺序：`time` 保留传入顺序（调用方已按最近活动倒序），
 * `name` 按显示名比较，同名时用完整路径决定先后。
 *
 * 传入 `pinned` 时，命中的项目按置顶先后排在最前，其余项目保持上式顺序。
 * 置顶项按归一化键匹配，重复的置顶记录只算一次，项目列表里没有的置顶项被忽略。
 */
export function orderProjectPaths(
  projects: readonly string[],
  mode: ProjectSortMode,
  pinned: readonly string[] = [],
): string[] {
  const ordered = [...projects];
  if (mode === "name") {
    ordered.sort((left, right) => {
      const byName = projectNameCollator.compare(projectDisplayName(left), projectDisplayName(right));
      if (byName !== 0) return byName;
      // 完整路径按码元比较：collator 会忽略大小写与数字写法，无法决定先后。
      return left < right ? -1 : left > right ? 1 : 0;
    });
  }
  if (pinned.length === 0) return ordered;

  const projectByKey = new Map<string, string>();
  for (const project of ordered) {
    const key = normalizeProjectKey(project);
    if (!projectByKey.has(key)) projectByKey.set(key, project);
  }

  const pinnedKeys = new Set<string>();
  const head: string[] = [];
  for (const entry of pinned) {
    const key = normalizeProjectKey(entry);
    if (pinnedKeys.has(key)) continue;
    const project = projectByKey.get(key);
    if (project === undefined) continue;
    pinnedKeys.add(key);
    head.push(project);
  }
  if (head.length === 0) return ordered;

  return [...head, ...ordered.filter((project) => !pinnedKeys.has(normalizeProjectKey(project)))];
}

/**
 * 把「当前选中但还没有会话」的项目放进已排好的列表：
 * 已置顶的项目落在它自己的置顶位次，否则排在全部置顶项之后、其余未置顶项目之前。
 * 列表里已有同一项目（按归一化键判断）时原样返回。
 */
export function placeSelectedProject(
  ordered: readonly string[],
  selected: string,
  pinned: readonly string[] = [],
): string[] {
  const selectedKey = normalizeProjectKey(selected);
  const orderedKeys = ordered.map(normalizeProjectKey);
  if (orderedKeys.includes(selectedKey)) return [...ordered];

  const pinOrder: string[] = [];
  const seen = new Set<string>();
  for (const entry of pinned) {
    const key = normalizeProjectKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    pinOrder.push(key);
  }

  const selectedPinIndex = pinOrder.indexOf(selectedKey);
  let insertAt: number;
  if (selectedPinIndex >= 0) {
    // 置顶位次只数列表里真实存在的置顶项，缺失的置顶记录不占位置。
    const present = new Set(orderedKeys);
    insertAt = pinOrder.slice(0, selectedPinIndex).filter((key) => present.has(key)).length;
  } else {
    insertAt = orderedKeys.findIndex((key) => !seen.has(key));
    if (insertAt < 0) insertAt = ordered.length;
  }

  return [...ordered.slice(0, insertAt), selected, ...ordered.slice(insertAt)];
}

/**
 * 清洗置顶序列：按归一化键去重，保留首次出现的位置与原始写法。
 */
export function dedupePinnedProjects(pinned: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const project of pinned) {
    const key = normalizeProjectKey(project);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(project);
  }
  return deduped;
}

/**
 * 切换项目的置顶状态：已置顶则从序列中移除，未置顶则追加到序列末尾。
 * 比较使用归一化键；返回新数组，不修改传入的置顶序列。
 */
export function togglePinnedProject(pinned: readonly string[], project: string): string[] {
  const key = normalizeProjectKey(project);
  const remaining = pinned.filter((entry) => normalizeProjectKey(entry) !== key);
  return remaining.length === pinned.length ? [...pinned, project] : remaining;
}
