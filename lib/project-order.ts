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

// 名称比较忽略大小写与数字写法差异，同名时的完整路径比较沿用同一规则。
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
      return byName !== 0 ? byName : projectNameCollator.compare(left, right);
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
 * 切换项目的置顶状态：已置顶则从序列中移除，未置顶则追加到序列末尾。
 * 比较使用归一化键；返回新数组，不修改传入的置顶序列。
 */
export function togglePinnedProject(pinned: readonly string[], project: string): string[] {
  const key = normalizeProjectKey(project);
  const remaining = pinned.filter((entry) => normalizeProjectKey(entry) !== key);
  return remaining.length === pinned.length ? [...pinned, project] : remaining;
}
