---
name: worktree-path
description: 手建的工作副本在 `.worktrees/`，界面建在同级 `<repo>-worktrees/`；建或删工作副本时读。
---

# 工作副本的两条创建路径

开发用的工作副本由人在仓库根手建，位置是 `<repo>/.worktrees/<branch>`，`.gitignore` 忽略该目录。ompdesk 界面里的「新建工作副本」由 `lib/worktree.ts` 的 `addWorktree()` 创建，位置是仓库同级的 `<repo>-worktrees/<sanitized-branch>`，分支名里的 `/` 会被压成 `-`。

`lib/worktree.ts` 把 linked worktree 的顶层路径解析回主仓库的 `projectRoot`，`listAllSessions()` 把它附加到每个会话，侧栏因此把同一仓库的所有工作副本归为一组。

## 后果

删除工作副本后，会话的 cwd 会被推断回主项目，但 `inferRemovedWorktree()` 只认 `-worktrees` 结尾的兄弟目录。手建在 `.worktrees/` 下的副本被删除后不满足这个条件，侧栏会留下一个已失效的项目。
