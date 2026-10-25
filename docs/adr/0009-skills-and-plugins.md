# 插件与 skills 的来源

`/api/plugins` 驱动 omp 的 `PluginManager`（`~/.omp/plugins`），提供安装、卸载、启用与禁用，并把 `doctor()` 输出作为诊断。omp 没有原地更新，所以「更新」是用 `force` 重装该 spec。

`/api/skills` 使用 omp 自己的 `loadSkills()`，`.omp/skills`、`~/.omp/agent/skills`、`.claude/skills`、插件 skills 与 `.agents/skills` 的列出结果与会话看到的一致。切换 skill 只改目标 `SKILL.md` 的 `disable-model-invocation` 键，保持其余 YAML 的原有格式。安装走 `npx skills add ... --agent claude-code`：`skills` CLI 没有 omp agent，它的 `pi` agent 写入 `~/.pi/agent/skills`，omp 不读该路径。
