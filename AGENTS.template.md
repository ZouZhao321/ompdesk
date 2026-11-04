# ompdesk - 团队开发规则

本文件是团队规则模板，不会被任何 agent 自动加载。开发者在仓库根建一个不提交的 `AGENTS.md`，
用 `@AGENTS.template.md` 引入本文件，再补充个人习惯；`CLAUDE.md` 同样只想 `AGENTS.md`，
所以没有个人文件的克隆不会拿到这些规则。

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
合并前的自检与 CI 都以该 worktree 为准，主检出的失败不构成阻塞；失败与本次改动
无关时，在 PR 描述里写明复现命令。主检出的未提交内容只挡住合并回主检出的这一步：
`git merge` 拒绝覆盖它，此时先在主检出提交或暂存，或改走 PR 合并。

worktree 之间真正共享的只有 `.git/info/exclude`、`.git/hooks`、`.git/config`、
stash 记录，以及 `bun run dev` 的 30141 端口与 `~/.omp/agent` 下的会话数据。

提交标题遵循 `type(scope): 中文描述`，`type` 取 `feat`、`fix`、`refactor`、`test`、
`docs`、`chore`、`perf`；描述结尾不加句号，整行不超过 72 字符；`Merge `、`Revert `、
`fixup! `、`squash! `、`amend! ` 前缀跳过校验。每个提交只对应一个逻辑变更。

仓库根 `.pre-commit-config.yaml` 在 commit-msg 阶段执行 `scripts/check-commit-msg.py`。
克隆后执行 `pre-commit install`（未安装时先 `pipx install pre-commit`）装钩子：配置
已声明 `default_install_hook_types`，这一条命令就会装到 commit-msg 上，标题不合规
的提交被拒绝。

## 临时文件

所有临时文件都写入 `.tmp/`：探针脚本、日志、截图、导出的 HTML、分析用的下载
数据，以及其他只在本任务内使用的产物。不得写入系统临时目录、仓库其他位置或
仓库外的目录。该目录已被 Git 忽略。

- 一个任务一个子目录：`.tmp/<任务名>/`，目录内必须有 `README.md` 写明用途与
  创建时间。
- 新目录用 `bun run scratch <任务名> "<用途>"` 创建，不要手工建。
- 子目录自包含：脚本、输入、输出都放在自己目录内，不与其他任务共享文件，也不
  写回仓库其他位置。
- `.tmp/` 可以整体删除，不影响仓库与构建。
- 位置跟随当前工作区：在 worktree 里执行就建在该 worktree 的 `.tmp/`，随
  worktree 一起清理。
- `.tmp/legacy/` 收纳早期的调查产物，内容不再维护。

## 命令

```bash
bun install
bun run dev   # port 30141
```

类型检查：`bun run typecheck`
Lint：`bun run lint`
测试：`bun test`

真实模型冒烟默认跳过，只有 `OMPDESK_LIVE_SMOKE=1 bun test lib/live-model-smoke.test.mjs`
才发出真实请求；`OMPDESK_LIVE_MODEL` 可选，用 omp 选择器语法（`provider/modelId`
或 `modelId`，可带 `:thinkingLevel`）。历史会话夹具优先用本机会话库，本机没有会话时铺
`test-support/session-fixtures.ts` 的确定性样本，只有会话库不可读才跳过。

开发期间不要执行 `bun run build`：会污染 `.next/` 并破坏 `bun run dev`。例外是
`bun run desktop:build`，它经 `scripts/stage-desktop.mjs` 通过 `OMPDESK_DIST_DIR`
构建到 `src-tauri/server/.next`，不碰开发用的 `.next/`。

运行环境固定为 Bun：`@oh-my-pi/pi-*` 以 TypeScript 源码发布并 import `bun:sqlite`，
Node 无法加载。`next.config.ts` 把每个 `@oh-my-pi/*` 请求 externalize 为 ESM
`import`，只靠 `serverExternalPackages` 不够。测试用 `bun test`，不用 `node --test`。

## 测试数据

- 测试样本只从 `test-support/session-fixtures.ts` 生成，不手写会话文件。
- 手工验证分两步，两步用的 agent 目录必须不同：铺样本会把标题写进活动目录的
  `history.db`，活动目录与目标 `agentDir` 相同会直接报错。
  1. 铺样本。首次先用 `bun run scratch` 建任务目录；活动目录放任务临时目录之外的
     运行时目录，样本落到任务目录：

     ```bash
     bun run scratch manual-check "手工验证会话样本"
     PI_CODING_AGENT_DIR="$PWD/.tmp/session-runtime" bun -e '
       const { seedSessions } = await import("./test-support/session-fixtures.ts");
       await seedSessions("branch", { agentDir: process.cwd() + "/.tmp/manual-check/agent", cwd: process.cwd() });
     '
     ```

     铺样本时不要把 `PI_CODING_AGENT_DIR` 指向 `.tmp/manual-check/agent`：那是目标
     `agentDir`，标题索引会写进样本目录。
  2. 用铺好的目录启动开发服务，界面只显示这批样本：

     ```bash
     PI_CODING_AGENT_DIR="$PWD/.tmp/manual-check/agent" bun run dev
     ```

     要发消息或切模型时，把 `~/.omp/agent/agent.db` 与 `~/.omp/agent/models.yml`
     复制进该目录，或在该目录内重新登录。

## 界面改动

界面改动必须附截图，能录视频的再附一段不超过一分钟的短视频，只演示这次的交互。
证据上传到 PR 评论的附件区，正文引用那条评论：

```
gh pr comment <PR> --body-file <文件> --attach <截图> --attach <视频>
```

`--attach` 需要 gh 2.99 以上；视频单独成段时渲染成播放器。截图与视频不提交进仓库，
避免占用 git 历史。截图至少覆盖默认状态、关键状态与手机档。

## 架构不变量

会话浏览只读 `.jsonl`，不创建 `AgentSession`；发消息时 `startRpcSession()` 才在
进程内创建。扩展通过 omp 的 `initializeExtensions()` 绑定，与 `omp --mode rpc`
同一套接线，上层叠加浏览器实现的 `ExtensionUIContext`。

## 侧边栏项目排序与置顶

- 排序方式为 `time`（默认，最近活动）或 `name`（目录最后一段；同名用完整路径码元顺序）；存在 `ompdesk:project-sort`，`time` 不写键。
- 置顶序列按点击先后存在 `ompdesk:pinned-projects`；置顶项始终排在未置顶项之前，按归一化键匹配并去重。
- 归一化规则：反斜杠转 `/`、Windows 盘符路径折叠大小写、去掉结尾分隔符但保留 `/` 与 `c:/`。
- 置顶只改变项目行顺序；项目内会话仍按写入时间倒序与 fork 缩进。
- 当前选中但没有会话的项目按置顶位次插入；选中判断与插入去重共用归一化键。
- 排序菜单支持方向键 / Home / End / Escape；菜单项不在 Tab 序列，焦点离开或选中即收起，关闭统一走 `onDismiss`。
- 手机档项目行、排序与项目操作菜单控件的可点区域为 `MOBILE_HIT_TARGET_PX`。

## 会话文件

会话文件在 `~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`，每行一条
JSON 记录，当前 `version: 3`。记录语义与顺序跟随 omp 的 transcript 语义，字段全集以
`@oh-my-pi/pi-coding-agent` 的 `session-entries.d.ts` 为准。

## 文档与决策

本文档每次会话都会加载，一句话也要占上下文。它只写长期成立的规则、命令与结构。
指针必须自带结论：每行先给必须记住的判断，再去给出处；只有要改那段代码、或要推翻
结论时才读原文。

索引条目一律写名字、用途与来源三样。只写名字的条目不成立：读者为了判断要不要用，
就得把目标整个读一遍。ADR 文件头部带 `name` 与 `description` 两个字段，`description`
说明它约束什么、什么时候读。新增规则、决策或快照时按 `docs/agents-md-method.md`
的步骤做。

架构决策记录留在维护者本机，不随仓库发布；仓库内只保留 `docs/agents-md-method.md`
描述的写法与 `docs/file-map.md` 的文件职责表。

`docs/file-map.md` 按目录列出每个文件的职责（路径加一句话），用于确认某个文件
属于哪一块；文件是否存在以 `git ls-files` 为准。

快照只留索引：规模数字、索引时间、机器路径、具体会话 id、接口方法与字段形状、
色值都不写进正文。

## 快照索引

- `路由与接口方法`: 查某个网址由哪个文件处理、支持哪些方法；来源 `app/api/` 目录结构，`git ls-files 'app/api/**/route.ts'`
- `模块与组件职责`: 查某个文件属于哪一块、大致做什么；来源 `docs/file-map.md`，打开该文件
- `会话文件格式`: 读写 `.jsonl` 时确认字段、顺序与版本；来源 `session-entries.d.ts`（`version: 3`），`grep -n CURRENT_SESSION_VERSION`
- `代码索引规模`: 判断代码地图是否过期、覆盖多少；来源 `.gitnexus/gitnexus.json` 的 `stats`，读 `stats.nodes` / `stats.edges` / `stats.processes`
- `模型角色清单`: 新增或改角色时对齐 SDK 定义；来源 SDK 的 `ModelRole` 类型，`grep -n "export type ModelRole"`
- `主题色值`: 改配色时找变量名与真实取值；来源 `/api/theme` 与 `pi-tui/src/theme/*.json`，请求接口或读主题 JSON
- `依赖与运行时版本`: 判断 Bun、Node 与 Next 的版本约束；来源 `package.json` 的 `engines` 与 `bun.lock`，读 `package.json`
- `测试样本会话`: 复现界面测试时定位数据；来源 `test-support/session-fixtures.ts` 的场景，铺到任务临时目录
