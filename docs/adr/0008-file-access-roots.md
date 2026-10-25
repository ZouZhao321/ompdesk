---
name: file-access-roots
description: 文件浏览只开放允许根，`/api/files` 的根由三个端点扩充；改文件访问或放行新目录时读。
---

# 文件访问是有允许根的

`/api/files` 刻意不是通用文件系统浏览器。允许的根来自会话 cwd、其解析后的项目根、`~/omp-cwd-*`，以及通过 `allowFileRoot()` 显式添加的根；`/api/cwd/validate`、`/api/default-cwd` 与 `/api/worktrees` 在让新位置可浏览时调用它。`/api/worktrees` 用同一组判定函数，所以两个端点的可见范围一致。
