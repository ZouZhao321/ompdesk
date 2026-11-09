/** `/api/worktrees` 返回的一个 checkout。 */
export interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
}

/** `/api/worktrees` 返回的一个本地分支，以及占用它的 checkout。 */
export interface BranchEntry {
  name: string;
  /** Path of the checkout holding this branch, null when none does */
  worktreePath: string | null;
  current: boolean;
}
