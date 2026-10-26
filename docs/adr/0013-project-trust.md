---
name: project-trust
description: 未信任项目过滤项目内扩展与工具并禁用 MCP，skills 与 rules 始终加载；改信任开关时读。
---

# 项目信任由 ompdesk 自己维护

omp 没有信任存储：它运行某个仓库的扩展，因为你选择在那里运行它。浏览器标签页不能代表这个决定，所以 `lib/project-trust.ts` 在 `~/.omp/agent/ompdesk-trusted-projects.json` 中维护存储，对未信任项目从 omp 发现的扩展与自定义工具路径中过滤项目内的条目，并禁用 MCP。

skills 与 rules 属于数据，始终加载；未信任项目同样加载项目内的 `SYSTEM.md` / `APPEND_SYSTEM.md`。见 `docs/project-trust.md`。
