# ompdesk - 开发说明

## Git 工作流

每次修改都经过独立 worktree 与 pull request。`main` 只接受合并：禁止在 `main` 上直接提交，禁止直接推送到 `main`。

1. 创建任何东西之前先检测是否已在隔离工作区。比较
   `git rev-parse --path-format=absolute --git-dir` 与 `--git-common-dir`：
   路径不同表示当前已在 linked worktree，原地工作并跳过创建。子模块
   （`git rev-parse --show-superproject-working-tree` 有输出）按普通检出处理。
2. 在普通检出中确认 `.worktrees/` 已被忽略：`git check-ignore -q .worktrees/`
   必须退出 `0`。未忽略时先把 `.worktrees/` 写入 `.gitignore` 并提交这次改动。
3. 在仓库根创建分支与 worktree：
   `git worktree add .worktrees/<branch> -b <branch> origin/main`。起点固定为
   `origin/main`，不用本地 `main`：本地 `main` 可能带着未推送到远端的合并，
   以它为起点会让这些提交一起进入 PR。分支名为 `type/description`，`type` 取
   `feat`、`fix`、`refactor`、`test`、`docs`、`chore`、`perf`。
4. 依赖缺失时执行 `bun install`。编辑前在当前 worktree 执行一次 `bun test`，
   把出现的失败记为既有基线；之后只要求不新增失败。
5. 所有编辑、提交、推送都在该 worktree 内完成。主检出留在 `main` 分支上，它的
   工作区状态不参与 worktree 的判定，也不构成阻塞。
6. 用 `gh pr create` 向 `main` 提 PR。创建 PR 与推送无需询问；合并 PR 需要用户
   明确授权。
7. PR 合并且用户同意清理后，才删除 worktree 与分支。

检查范围是本 worktree 的代码。`bun run typecheck`、`bun run lint`、`bun test`、
合并前的自检与 CI 都以该 worktree 为准，主检出的失败不构成阻塞。主检出的未提交
内容只挡住合并回主检出这一步：`git merge` 拒绝覆盖它，此时先在主检出提交或暂存，
或改走 PR 合并。

提交标题遵循 `type(scope): 中文描述`，每个提交只对应一个逻辑变更。

## 命令

```bash
bun install
bun run dev   # port 30141
```

类型检查：`bun run typecheck`
Lint：`bun run lint`
测试：`bun test`

开发期间不要执行 `bun run build`：会污染 `.next/` 并破坏 `bun run dev`。例外是
`bun run desktop:build`，它经 `scripts/stage-desktop.mjs` 通过 `OMPDESK_DIST_DIR`
构建到 `src-tauri/server/.next`，不碰开发用的 `.next/`。

运行环境固定为 Bun：`@oh-my-pi/pi-*` 以 TypeScript 源码发布并 import `bun:sqlite`，
Node 无法加载。`next.config.ts` 把每个 `@oh-my-pi/*` 请求 externalize 为 ESM
`import`，只靠 `serverExternalPackages` 不够。测试用 `bun test`，不用 `node --test`。

## 测试工作区

界面、地图与交互的手工测试在 `C:\Users\ZouZhao\Desktop\Project\ompdesk-lab` 进行：
把 ompdesk 的工作目录切到那里再开会话。真实项目目录不作为测试数据的写入位置；该
目录的 `AGENTS.md` 记录复现步骤与预期结果。

## 架构不变量

会话浏览只读 `.jsonl`，不创建 `AgentSession`；发消息时 `startRpcSession()` 才在
进程内创建。扩展通过 omp 的 `initializeExtensions()` 绑定，与 `omp --mode rpc`
同一套接线，上层叠加浏览器实现的 `ExtensionUIContext`。

## 会话文件

会话文件在 `~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`，每行一条
JSON 记录，当前 `version: 3`。记录语义与顺序见 ADR-0004，字段全集以
`@oh-my-pi/pi-coding-agent` 的 `session-entries.d.ts` 为准。

## 代码索引

改函数、类或方法之前先用 `impact` 看影响范围并向用户报告；提交前用
`detect_changes({scope: "all"})` 确认改动只落在预期的符号与流程上。重命名用
`rename`，不用查找替换。索引数据的读取方式见下面的快照索引。

## 文档与决策

本文档每次会话都会加载，一句话也要占上下文。它只写长期成立的规则、命令与结构。
指针必须自带结论：每行先给必须记住的判断，再去给出处；只有要改那段代码、或要推翻
结论时才读原文。

| 改什么 | 结论 | 出处 |
| --- | --- | --- |
| 会话生命周期、fork | fork 原地改写 sessionId；返回新 id 前销毁 wrapper，下一次请求从原文件重建 | `adr/0001` |
| 运行时接线 | 进程内只有一个 Settings + AuthStorage + ModelRegistry，缓存挂 globalThis；第二个 AuthStorage 会分裂凭据事件 | `adr/0002` |
| 选模型、改角色 | 角色清单以 SDK 的 `ModelRole` 为准；`enabledModels` 委托 `resolveModelScope()`，解析为空回退全部 | `adr/0003` |
| 读会话记录、拼上下文 | 顺序跟随 omp 的 transcript 语义，摘要渲染在压缩位置；`entryIds` 本地生成；`SessionManager` 全是异步 | `adr/0004` |
| 分支功能 | fork 写新文件，`parentSession` 可写 id 或路径；会话内分支走 `navigate_tree` | `adr/0005` |
| 会话地图 | 按轮现算，按 mtime 与大小缓存；子代理会话不入图；切点取无悬空工具调用的条目 | `adr/0006` |
| 建或删工作副本 | 手建在 `.worktrees/`，界面建在同级 `<repo>-worktrees/`；删除后的会话推断只认后者 | `adr/0007` |
| 改文件浏览 | `/api/files` 只开放允许根：会话 cwd、项目根、`~/omp-cwd-*`、显式添加的根 | `adr/0008` |
| 改插件与 skills | 五类 skills 来源；开关只改 `disable-model-invocation`；安装用 `--agent claude-code` | `adr/0009` |
| 改凭据、`models.yml` | 凭据在 `agent.db`，写走 `credentials.*` 与 `oauth.login`；写后必须失效运行时与模型两个缓存 | `adr/0010` |
| 改访问控制 | 密码只存 scrypt 摘要；`proxy.ts` 在 Node 运行时且不引 SDK；文件缺失与不可读必须区别对待 | `adr/0011` |
| 改流式、运行状态 | `prompt_done` 收尾、空闲 30 秒宽限；等待集合独立于运行集合；旧 run id 的迟到事件必须忽略 | `adr/0012` |
| 改项目信任 | 未信任项目过滤项目内扩展与工具并禁用 MCP；skills 与 rules 始终加载 | `adr/0013` |
| 改样式、主题 | 主题来自 omp，`globals.css` 是首屏回退，运行期由 `/api/theme` 覆盖；字体只用系统列表 | `adr/0014` |

`docs/file-map.md` 按目录列出每个文件的职责（路径加一句话），用于确认某个文件
属于哪一块；文件是否存在以 `git ls-files` 为准。

快照只留索引：规模数字、索引时间、机器路径、具体会话 id、接口方法与字段形状、
色值都不写进正文。

## 快照索引

| 快照 | 稳定标识 | 权威来源 | 读取方式 |
| --- | --- | --- | --- |
| 路由与接口方法 | `app/api/` 目录结构 | 各 `route.ts` 的导出 | `git ls-files 'app/api/**/route.ts'` |
| 模块与组件职责 | 文件路径 | 文件头注释与导出 | 读 `docs/file-map.md` 或直接打开 |
| 会话文件格式 | `version: 3` | `session-entries.d.ts` | `grep -n CURRENT_SESSION_VERSION` |
| 代码索引规模 | `.gitnexus/` | `gitnexus.json` 的 `stats` | 读 `stats.nodes` / `stats.edges` / `stats.processes` |
| 模型角色清单 | `modelRoles` 记录 | SDK 的 `ModelRole` 类型 | `grep -n "export type ModelRole"` |
| 主题色值 | CSS 变量名 | `/api/theme` 与 `pi-tui/src/theme/*.json` | 请求接口或读主题 JSON |
| 依赖与运行时版本 | `package.json` 的 `engines` | `package.json` 与 `bun.lock` | 读 `package.json` |
| 测试样本会话 | 会话 id | `~/.omp/agent/sessions/` | 按 id 检索文件 |
