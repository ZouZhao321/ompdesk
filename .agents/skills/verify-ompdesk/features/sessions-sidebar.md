# 会话侧栏

## Sub-features

- 项目分组与折叠：按仓库根归组，linked worktree 归到主仓库下
- 会话行：标题、未读、运行中、等待输入三种指示
- 搜索过滤：同时匹配项目名与会话标题
- 新建会话、刷新列表、归档区、当前运行会话的高亮
- 手机档：抽屉形态，选中行常驻显示重命名/归档/删除

## How to get to it (user POV)

桌面档一进页面就在左侧。手机档（宽度 ≤ 768px，或粗指针且高度 ≤ 480px）默认关闭，用顶栏的侧栏按钮拉开。

## Driving it with the browser harness

1. 断言 `.sidebar-project-row` 至少一个，`.sidebar-session-row` 至少一个（前提是本机有历史会话）。
2. 在 `input[type=search]` 输入一个项目名片段，`.sidebar-session-row` 数量应当减少；清空后恢复。
3. 点任意 `.sidebar-session-row`，中间聊天区应当出现该会话内容，顶栏出现分支按钮。
4. 手机档复核：viewport 设为 390×844，初始 `.sidebar-container` 带 `sidebar-closed`；点顶栏的侧栏按钮后带 `sidebar-open`，并且行高不低于 44px（`.sidebar-session-row` 计算高度）。

## Gotchas

- 列表为空不等于坏了：先看 `~/.omp/agent/sessions` 下有没有会话文件，再看 `GET /api/sessions` 的返回。
- 会话标题可能被 `sessionDisplayTitle()` 折叠过技能展开，搜索时用折叠后的文本。
- 行数据有缓存，手动刷新按钮会绕过缓存；搜索过滤是前端本地过滤，不会重新请求。
- 手机档没有悬停态，行操作只在选中行出现，不要用 hover 断言。
