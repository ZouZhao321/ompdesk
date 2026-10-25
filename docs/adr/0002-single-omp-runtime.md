---
name: single-omp-runtime
description: 进程内只有一个 Settings、AuthStorage、ModelRegistry；改运行时接线或凭据来源时读。
---

# 进程内只有一个 omp 运行时

omp 的 CLI 每进程构建一次 `Settings` + `AuthStorage` + `ModelRegistry`，ompdesk 照做并缓存到 `globalThis.__ompRuntimePromise`。第二个 `AuthStorage` 会在 `~/.omp/agent/agent.db` 上打开第二个 SQLite 句柄，并把 `credential_disabled` 事件分裂到两个实例；按项目的设置来自 `settings.cloneForCwd(cwd)`，不来自第二次 `Settings.init()`。
