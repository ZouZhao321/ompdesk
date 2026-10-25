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

1. 断言 `[data-project-path]` 至少一个，`[data-session-id]` 至少一个。首次打开页面要等 `/api/sessions` 返回，本机 745 个会话约 10–25 秒，行数为 0 时先等再判。
2. 在 `input[type=search]` 输入一个项目名片段，`[data-session-id]` 数量应当减少；清空后恢复。清空用 `Control` 加 `a` 再 `Backspace`，`fill("")` 不会触发 React 的输入事件，列表会停在过滤状态。
3. 点任意 `[data-session-id]`，中间聊天区应当出现该会话内容，输入区出现 `textarea`（加载会话需要几秒）。
4. 手机档复核：viewport 设为 390×844，初始 `.sidebar-container` 带 `sidebar-closed`；点 `[data-toggle="sidebar"]` 后带 `sidebar-open`。行高 44px 是包含手机适配（`lib/mobile-layout.ts`）的分支上的期望；未合入该改动的分支仍是 40px，按实际值记录并在结论里写明分支。

## Gotchas

- 列表为空不等于坏了：先看 `~/.omp/agent/sessions` 下有没有会话文件，再看 `GET /api/sessions` 的返回。
- 会话标题可能被 `sessionDisplayTitle()` 折叠过技能展开，搜索时用折叠后的文本。
- 行数据有缓存，手动刷新按钮会绕过缓存；搜索过滤是前端本地过滤，不会重新请求。
- 手机档没有悬停态，行操作只在选中行出现，不要用 hover 断言。
