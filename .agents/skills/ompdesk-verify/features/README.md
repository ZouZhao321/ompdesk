# ompdesk 功能地图

每次验证挑一条与改动相关的路径，按文件里的步骤走，把动作与结果记进 `.verify/<时间戳>/`。

| 功能 | 用户入口 | 文件 |
|---|---|---|
| 会话侧栏 | 桌面档左侧固定栏；手机档为抽屉 | `sessions-sidebar.md` |
| 右侧文件面板 | 顶栏右侧文件面板开关 | `file-explorer-panel.md` |
| 输入区与模型 | 底部输入区 | `composer-and-models.md` |

新增功能时写一个文件，四节固定为 `Sub-features`、`How to get to it (user POV)`、
`Driving it with the browser harness`、`Gotchas`，并在这张表里补一行。改了界面之后如果选择器变了，
先更新这里再验证，否则下一个人只能靠猜。
