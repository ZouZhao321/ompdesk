/** 侧边栏项目行的排序方式：按最近活动时间，或按工作目录名称。 */
export type ProjectSortMode = "time" | "name";

/** 项目分组的显示名：工作目录最后一段。 */
export function projectDisplayName(project: string): string {
  const segments = project.replace(/[\\/]+$/, "").split(/[\\/]/);
  return segments.at(-1) || project;
}

/**
 * 项目比较键：反斜杠统一为正斜杠；Windows 盘符路径折叠大小写。
 *
 * 与侧边栏「移除项目」共用同一规则，置顶路径在大小写写法不同时仍能匹配。
 */
export function normalizeProjectKey(project: string): string {
  const normalized = project.replace(/\\/g, "/");
  return /^[a-zA-Z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

/**
 * 项目行顺序：置顶项目永远在前，按置顶先后排列；其余项目按给定方式排序。
 *
 * `time` 方式保留传入顺序（调用方已按最近活动倒序），`name` 方式按显示名比较，
 * 同名时用完整路径决定先手。`Array.prototype.sort` 稳定，未置顶项目的时间顺序
 * 不会被打乱。
 */
export function orderProjectPaths(
  projects: readonly string[],
  mode: ProjectSortMode,
  pinnedProjects: readonly string[],
): string[] {
  const pinRank = new Map<string, number>();
  pinnedProjects.forEach((project, index) => {
    const key = normalizeProjectKey(project);
    if (!pinRank.has(key)) pinRank.set(key, index);
  });
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return [...projects].sort((left, right) => {
    const leftRank = pinRank.get(normalizeProjectKey(left));
    const rightRank = pinRank.get(normalizeProjectKey(right));
    if (leftRank !== undefined || rightRank !== undefined) {
      if (leftRank === undefined) return 1;
      if (rightRank === undefined) return -1;
      if (leftRank !== rightRank) return leftRank - rightRank;
    }
    if (mode === "name") {
      const byName = collator.compare(projectDisplayName(left), projectDisplayName(right));
      return byName !== 0 ? byName : collator.compare(left, right);
    }
    return 0;
  });
}

/** 置顶或取消置顶；新置顶追加到末尾，因此列表顺序就是操作先后顺序。 */
export function togglePinnedProject(
  pinnedProjects: readonly string[],
  project: string,
): string[] {
  const key = normalizeProjectKey(project);
  return pinnedProjects.some((pinned) => normalizeProjectKey(pinned) === key)
    ? pinnedProjects.filter((pinned) => normalizeProjectKey(pinned) !== key)
    : [...pinnedProjects, project];
}
