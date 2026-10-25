---
name: session-record-and-context
description: 记录顺序跟随 omp 的 transcript 语义，entryIds 本地生成；改会话读取或上下文拼接时读。
---

# 会话记录与上下文构建

聊天记录对应 omp 的 `{ transcript: true, collapseCompactedHistory: true }` 语义：被最近一次压缩替换的历史省略，摘要渲染在压缩发生的时间位置，即保留消息之后、压缩之后的轮次之前。这与模型看到的上下文不同，后者把摘要放在开头。

`entryIds` 与 `messages` 平行，在本地遍历得到，因为 omp 的 `buildSessionContext` 不返回条目 id。工具调用块的字段在 `lib/normalize.ts` 的 `normalizeToolCalls()` 里归一化，文件加载与流式两条路径共用。`SessionManager.open()` / `forkFrom()` / `continueRecent()` / `setSessionName()` / `newSession()` / `flush()` 都返回 Promise，漏掉 `await` 会拿到 Promise 的属性错误。
