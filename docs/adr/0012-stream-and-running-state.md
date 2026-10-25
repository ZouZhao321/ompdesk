# 流式与运行状态

每个会话的 SSE 是聊天事件的主要来源，在每次 prompt 前打开。`prompt_done` 立即结束当前 UI 阶段与通知；空闲 SSE 保持 30 秒宽限窗口，并被下一个 prompt 复用。`agent_start` 取消关闭计时器；`agent_settled` 结束由扩展注入、没有 wrapper 级 `prompt_done` 的运行，并开始新的宽限窗口。第一个 `agent_end` 不关闭流，因为重试、压缩与扩展排队的消息可能继续同一个逻辑 prompt。

运行状态在标签页可见时每 2.5 秒轮询 `/api/agent/running`，后台标签页暂停；快照含 `runningSessionIds`、`waitingSessionIds` 与 `sessionIdsByRuntimeId`。等待输入的会话按 `pendingUiRequests` 是否为空判断，它和 `isRunning()` 是两个独立集合——空闲会话也可能挂着阻塞式 UI 请求。运行期间还会定期调用 `GET /api/agent/[id]`，并在 `visibilitychange` / `online` 时核对，修复半开连接丢失的终止事件。

prompt 运行使用单调递增的 run id；来自旧运行的迟到事件与慢核对响应必须忽略，否则会复活过期的流式气泡。
