# ompdesk 里的 Worktree

ompdesk 会把同一个 Git 项目的 main checkout 和 linked worktree 放在同一个项目下。你可以用它在不同分支之间切换工作目录，同时保留统一的会话列表。

## 什么时候会看到 Worktree 控件

当左上角选择的是 Git 仓库根目录时，项目选择器下面会出现 worktree 切换控件。

以下情况不会显示：

- 当前目录不是 Git 仓库。
- 当前目录在某个 Git 仓库里面，但不是仓库根目录。
- Git 无法读取这个仓库的 worktree 列表。

如果你在仓库子目录里，先从项目选择器打开仓库根目录，再管理 worktree。

## 切换分支会影响什么

worktree 切换器列出的是仓库的本地分支，不是 checkout 目录。每一行标出这条分支是否已有副本：

- 已有副本：选中后直接切到那个 checkout，不新建目录。
- 没有副本：选中后先在 `<repo>-worktrees/<branch>` 建一份，再切过去。

没有本地分支指向的检出（例如其他工具留下的 detached HEAD）单独成一行，标注「游离检出」；只能从这一行把它移除。

分支清单读不出来时，切换器回退成按检出目录列出，删除按钮与正常列表一致。

一条分支同一时刻只能被一个 checkout 占用，所以列表按分支而不是按目录组织。

它会影响：

- 从侧边栏新建的会话。
- 右侧文件面板中的 Explorer 浏览的文件。
- 从 Explorer 插入到输入框里的文件路径。

已有会话仍然按同一个 project root 分组。点击一个已有会话时，侧边栏会回到这个会话原本所在的 checkout。

## 新建 Worktree

在 worktree 菜单里选择 `New worktree...`，输入 branch name。

ompdesk 会把 checkout 放在：

```text
<repo>-worktrees/<branch>
```

例如 main checkout 是：

```text
/Users/alex/Documents/Workspace/ompdesk
```

新建 `codex/worktree-help` 时，目录会是：

```text
/Users/alex/Documents/Workspace/ompdesk-worktrees/codex-worktree-help
```

如果这条 branch 已有副本，ompdesk 直接复用。branch 存在但没有副本时补一份；branch 不存在时从当前 `HEAD` 创建。

两条 branch 名压平后可能落到同一个目录名：`feat/a-b` 与 `feat/a/b` 都会变成 `feat-a-b`。后建的一份追加序号后缀（`feat-a-b-2`），不覆盖先建的那份。

## 删除 Worktree

每一行只要它的副本不是主检出，右侧就有删除按钮，游离检出行也有；它删除的是那个 checkout 目录。

删除 worktree 不会删除：

- Git branch。
- ompdesk 的历史会话。
- main checkout。

如果 worktree 里有未提交或未跟踪文件，Git 会拒绝删除。ompdesk 会再显示 force remove。force remove 会丢弃这个 checkout 里的未提交文件，只在确定不需要这些改动时使用。

## 会话和 Worktree 的关系

ompdesk 按 project root 分组会话，所以 main checkout 和 linked worktree 里的会话会显示在一起。

但每个会话仍然记得自己创建时的 working directory：

- 在某个 worktree 创建的会话，会继续使用那个 worktree path。
- 在 main checkout 创建的会话，会继续使用 main checkout。
- 如果某个 worktree 已被删除，它的历史会话仍会显示在项目下，方便你找回上下文。

## 常见问题

**为什么我看不到 worktree 切换器？**
请确认当前选择的是 Git 仓库根目录。非 Git 目录和仓库子目录会显示一行轻提示，而不是切换器。

**为什么某个 branch 不能创建 worktree？**
Git 不允许同一个 branch 同时被多个 worktree checkout。你可以切到已有的 worktree，或者先删除那个 checkout。

**Git 里还有已经消失的 worktree 记录怎么办？**
Git 有时会保留 prunable worktree 记录。ompdesk 不在切换器里显示这些记录；再次切到那条分支时，会先清理这条分支的失效登记再建新副本，但只清理指向 `<repo>-worktrees` 之内的记录，别处的记录保持不动。

**切换时提示副本被锁定、登记损坏或不可达。**
- `Checkout is locked`：执行 `git worktree unlock <路径>` 后再切换。
- `Checkout registration is broken`：目录还在、里面也有改动，只是 `.git` 链接损坏。手工移除该目录，或用 `git worktree repair` 重建链接。
- `Checkout is unreachable`：记录指向 `<repo>-worktrees` 之外，要么是手工建的副本，要么是盘没挂载。恢复挂载后重试；确实不要了，再手动执行 `git worktree prune`。

**Explorer 和当前聊天看起来不在同一个分支？**
Explorer 跟随当前选择的 worktree；聊天跟随打开的会话。重新点击会话，可以把侧边栏切回这个会话所在的 checkout。
