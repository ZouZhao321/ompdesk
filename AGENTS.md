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

本文档每次会话都会加载，一句话也要占上下文。它只写长期成立的规则、命令与结构；
关键决策与原因在 `docs/adr/`，改对应模块前先读那一条：

| 模块 | ADR |
| --- | --- |
| 会话 wrapper 与 fork | `0001` |
| 进程内运行时 | `0002` |
| 模型角色与 `enabledModels` | `0003` |
| 会话记录与上下文 | `0004` |
| 两种分支 | `0005` |
| 会话地图 | `0006` |
| 工作副本路径 | `0007` |
| 文件访问允许根 | `0008` |
| 插件与 skills | `0009` |
| 凭据与 `models.yml` | `0010` |
| 密码锁 | `0011` |
| 流式与运行状态 | `0012` |
| 项目信任 | `0013` |
| 主题与 CSS 变量 | `0014` |

完整文件清单在 `docs/file-map.md`，按需读。快照只留索引：规模数字、索引时间、
机器路径、具体会话 id、接口方法与字段形状、色值都不写进正文。

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
