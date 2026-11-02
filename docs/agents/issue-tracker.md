# 诉求与需求的两个入口

外部诉求进 GitHub Issues，内部需求与规格进内部追踪器。规格只存在于内部追踪器，不出现在
GitHub 的 issue、PR 与提交里。

## 谁看哪里

| 对象 | 入口 | 承载 | 可见范围 |
| --- | --- | --- | --- |
| 外部：使用者、开源贡献者 | GitHub Issues | 缺陷、功能请求、使用问题 | 公开 |
| 内部：维护者 | 内部追踪器 | PRD、规格、排期、模块与状态 | 仅维护者 |

判定只用一句话：外部用户能不能看到这件事。能，走 GitHub；不能，走内部追踪器。规格永远在
内部。

## 外部诉求

- 入口是仓库的 issue 表单：`.github/ISSUE_TEMPLATE/bug_report.yml` 与
  `feature_request.yml`，空白 issue 已关闭，必须选表单。
- issue 是请求，不是排期承诺。处理结论只有三种：采纳、不采纳、需要更多信息；三者都在
  issue 里回复。
- 采纳的诉求进内部追踪器：正文写需求，评论写 `规格 vN：`，工作项上挂一条原 issue 链接。
- 实施完成后回到原 issue 回帖结果并关闭。
- issue、PR、提交与评论里不出现内部追踪器的地址、工作项 id、内部讨论原文与未公开的计划。

## 内部需求与规格

维护者本机的 `~/.omp/agent/plane.md` 记录坐标、正文模板、规格评论规则与校验命令。
一条工作项只有正文与评论区两个位置：正文写需求（背景、目标、验收标准、约束可选、范围外），
评论区写规格，以 `规格 vN：` 开头，编号最大的一条为当前有效版本，每次写全量。

## 状态同步

追踪器的状态由仓库事实驱动，命令在本机执行，配置从环境变量读取：

- 开工：`bun run tracker:claim --ref <序号> [--assignee <成员名>]`。状态改为 In Progress，
  指定负责人后能从工作项上看到谁在做。
- 关联 PR：`bun run tracker:link --ref <序号> --pr <PR 号>`。在链接字段写入 `PR #N`。
- 合并收尾：`bun run tracker:done --pr <PR 号> --ref <序号>...`。状态改为 Done，并追加一条
  评论，写明 PR 链接、合并提交与 CI 结果；父项与子项一起传。
- 环境变量：`TRACKER_PROJECT_ID`、`TRACKER_API_KEY` 必填；`TRACKER_BASE_URL`、
  `TRACKER_WORKSPACE`、`TRACKER_ASSIGNEE` 可选。

PR 与工作项的对应关系存在追踪器的链接字段，不出现在仓库、PR 或提交里。
