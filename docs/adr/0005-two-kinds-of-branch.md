---
name: two-kinds-of-branch
description: fork 写新文件，parentSession 可写 id 或路径；改分支、侧栏树或删除级联时读。
---

# 两种分支不要混淆

fork 创建新的 `.jsonl` 文件，通过 `parentSession` 头字段在侧栏显示为子节点；该字段可能写会话 id（`fork()`）或绝对路径（`createBranchedSession()`），两种写法都要解析成父行。会话内分支在同一文件内调用 `navigate_tree`，切换时用 `/api/sessions/[id]/context?leafId=` 取上下文。

`parentSession` 只是显示元数据，不参与聊天内容构造，所以整文件重写是安全的；删除会话时用它改挂子节点。

## 后果

只解析路径形式的地方读不到 id 形式的父子关系。
