# 模型角色就是模型选择器

omp 按工作范围分配模型，角色记录在 `config.yml` 的 `modelRoles` 里，权威清单来自 SDK 的 `ModelRole` 类型（`default`、`smol`、`slow`、`vision`、`plan`、`commit`、`tiny`、`memory`、`task`、`advisor`，另有 `image`、`web`、`speech`、`dictation`、`judge` 作为种类角色）。`GET /api/models` 返回解析后的整张表，`ChatInput` 因此在扁平模型列表上方列出角色；`set_role_model` 切换会话并把角色写进会话记录，与 TUI 的 `/model` 写入同一位置。

`enabledModels` 使用 omp 的 `--models` 语法（`provider/modelId` 或裸 `modelId` 的 glob，可带 `:thinkingLevel`），解析委托给 SDK 的 `resolveModelScope()`，解析为空时回退到全部可用模型。

## 后果

浏览器中的显式模型选择只在新建会话时写成 `modelRoles.default`；会话内切换不回写该记录。
