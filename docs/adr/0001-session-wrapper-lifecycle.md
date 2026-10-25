# 会话 wrapper 生命周期与 fork

一个会话 id 对应一个 `AgentSessionWrapper`，注册表挂在 `globalThis.__ompSessions` 而不是模块级 Map，Next.js 热重载后注册表仍然有效；并发的 `startRpcSession()` 共享同一个启动 Promise（`globalThis.__ompStartLocks`），空闲 10 分钟后释放。`fork()` 会原地改写 wrapper 持有的 sessionId，所以在返回新 id 之前必须销毁 wrapper，让下一次请求从原始文件重建一个干净会话。

## 后果

fork 之后不能复用旧实例；任何缓存 wrapper 引用的代码都会拿到已 fork 的状态。
