/** 侧边栏项目行的排序方式：按最近活动时间，或按工作目录名称。 */
export type ProjectSortMode = "time" | "name";

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
 */
export function orderProjectPaths(projects: readonly string[], mode: ProjectSortMode): string[] {
  const ordered = [...projects];
  if (mode === "name") {
    ordered.sort((left, right) => {
      const byName = projectNameCollator.compare(projectDisplayName(left), projectDisplayName(right));
      return byName !== 0 ? byName : projectNameCollator.compare(left, right);
    });
  }
  return ordered;
}
