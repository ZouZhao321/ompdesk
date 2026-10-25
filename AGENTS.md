# ompdesk - 开发说明

## Git 工作流

每次修改都经过独立 worktree 与 pull request。禁止在 `main` 上直接提交。

1. 创建任何东西之前先检测是否已在隔离工作区。比较
   `git rev-parse --path-format=absolute --git-dir` 与 `--git-common-dir`：
   路径不同表示当前已经是 linked worktree，原地工作并跳过创建。子模块
   （`git rev-parse --show-superproject-working-tree` 有输出）按普通检出处理。
2. 在普通检出中确认 `.worktrees/` 已被忽略：`git check-ignore -q .worktrees/`
   必须退出 `0`。未忽略时先把 `.worktrees/` 写入 `.gitignore` 并提交这次改动，
   再创建 worktree。
3. 在仓库根同时创建分支与 worktree：`git worktree add .worktrees/<branch> -b <branch>`。
   分支名格式为 `type/description`，`type` 取 `feat`、`fix`、`refactor`、`test`、
   `docs`、`chore`、`perf`。检出目录为 `<repo>/.worktrees/<branch>`，这是所有任务
   的默认位置。
4. 依赖缺失时执行 `bun install`，编辑前执行 `bun test` 确认基线干净。
5. 所有编辑、提交、推送都在该 worktree 内完成。主检出保持在 `main` 且保持干净。
6. 用 `gh pr create` 向 `main` 提 PR。创建 PR 与向 PR 推送无需询问；合并 PR 需要
   用户明确授权。
7. PR 合并且用户同意清理后，才删除 worktree 与分支。

提交标题遵循 `type(scope): 中文描述`，`type` 取上述 7 个之一。每个提交只对应一个
逻辑变更。

## 快速开始

```bash
bun install
bun run dev   # port 30141
```

类型检查：`bun run typecheck`
Lint：`bun run lint`
测试：`bun test`
**开发期间不要执行 `bun run build`**：会污染 `.next/` 并破坏 `bun run dev`。
例外：`bun run desktop:build`（经 `scripts/stage-desktop.mjs`）是安全的，它通过
`OMPDESK_DIST_DIR` 构建到 `src-tauri/server/.next`，不会碰开发用的 `.next/`。

## 测试工作区

所有测试都在 `C:\Users\ZouZhao\Desktop\Project\ompdesk-lab` 下进行：把 ompdesk 的
工作目录切到那里，再开会话、跑界面操作与地图交互。真实项目目录不作为测试数据的
落点。

- 现有样本会话：`e7f54ac1-7dcb-497a-ae36-30cfdda3a2d3`，rag-eval-lab
  「GitHub Projects 表格使用说明」的副本，28 轮、519 条消息，含 1 个会话内分支。
- 该目录的 `AGENTS.md` 记录了复现步骤与预期结果。

### 全部运行在 Bun 上

`@oh-my-pi/pi-*` 以 **TypeScript 源码**发布并 import `bun:sqlite`，Node 完全无法加载
（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`）。ompdesk 的服务端部分因此只能在
Bun 上运行；`bin/ompdesk.js` 找到 Bun 二进制并通过它重新执行 `next start`。

两个后果需要记住：

- `next.config.ts` 把**每个** `@oh-my-pi/*` 请求 externalize 为 ESM `import`，不用
  `commonjs`。SDK 的 `exports` map 只声明 `import` 条件，`require()` 无法解析它；
  *Collecting page data* 阶段报 "Cannot find module '@oh-my-pi/pi-coding-agent'"
  就是这个原因。只靠 `serverExternalPackages` 不够：它漏掉 SDK 自己的传递入口。
- 用 `bun test`，不用 `node --test`。测试文件基于 `node:test`，Bun 能运行它们；
  Node 无法 import 测试所验证的 SDK。

---

## 架构

```
Browser                Next.js Server (Bun)        AgentSession (in-process)
  │                        │                               │
  ├─ GET /api/sessions ────▶ reads ~/.omp/agent/sessions/  │
  ├─ GET /api/sessions/[id] reads .jsonl file directly     │
  ├─ GET /api/agent/running ───────▶ running id snapshot   │
  │                        │                               │
  ├─ send message ─────────▶ POST /api/agent/[id]          │
  │                        │   startRpcSession() ─────────▶│ createAgentSession()
  │                        │   session.send(cmd) ─────────▶│ session.prompt()
  │                        │                               │
  ├─ SSE connect ──────────▶ GET /api/agent/[id]/events    │
  │                        │   session.onEvent() ◀─────────│ session.subscribe()
  │◀── data: {...} ─────────│                               │
```

**会话浏览**（只读）：通过 SDK 辅助函数与 `lib/session-reader.ts` 读取 `.jsonl`
文件，不创建 AgentSession。
**发送消息**：`lib/rpc-manager.ts` 中的 `startRpcSession()` 在进程内创建
AgentSession。

---

## 文件表

```
app/api/
  sessions/route.ts               GET  列出全部会话
  sessions/[id]/route.ts          GET/PATCH/DELETE 会话
  sessions/[id]/context/route.ts  GET ?leafId= 指定叶节点的上下文
  sessions/[id]/map/route.ts      GET 会话地图（轮次树）；?turn= 取单轮全文
  sessions/[id]/export/route.ts   GET 导出会话 HTML
  agent/new/route.ts              POST { cwd, message, toolNames?, provider?, modelId? }
  agent/[id]/route.ts             GET 状态 | POST 任意命令
  agent/[id]/events/route.ts      GET SSE 流
  agent/running/route.ts          GET 当前运行中的会话 id
  agent/running/events/route.ts   GET 当前运行中会话 id 的 SSE 流
  auth/all-providers/route.ts     GET API-key 提供方列表
  auth/api-key/[provider]/route.ts GET/POST/DELETE 提供方 API key 状态与存储
  auth/login/[provider]/route.ts  GET OAuth/device-code SSE | POST 手动 code
  auth/logout/[provider]/route.ts POST OAuth 登出
  auth/providers/route.ts         GET OAuth 提供方列表
  cwd/validate/route.ts           POST 校验/选择 cwd
  default-cwd/route.ts            POST 创建 ~/omp-cwd-YYYYMMDD
  files/[...path]/route.ts        GET 供查看器使用的文件内容
  home/route.ts                   GET 用户主目录
  model-roles/route.ts            GET/PUT omp 的 modelRoles 记录
  models/route.ts                 GET { models, modelList, defaultModel, roles }
  models-config/route.ts          GET/PUT 读写 ~/.omp/agent/models.yml
  models-config/catalog/route.ts  GET models.dev 价格预设
  models-config/discover/route.ts POST 获取已配置提供方的上游模型列表
  models-config/test/route.ts     POST 测试已配置的模型与提供方
  plugins/route.ts                GET/POST omp 插件管理
  skills/route.ts                 GET/PATCH 已加载 skills 与 disable-model-invocation
  skills/install/route.ts         POST 通过 npx skills add 安装 skills
  web-access/route.ts             GET/PUT 密码锁（设置 -> 访问）
  web-access/recovery/route.ts    POST 恢复码申请与兑换（未认证）
  worktrees/route.ts              GET/POST/DELETE git worktree

lib/
  agent-client.ts      为 /api/agent 命令提供带类型的 fetch 辅助
  draft-store.ts       本地草稿持久化辅助
  file-access.ts       /api/files 与 worktree 允许的文件根
  file-paths.ts        客户端与服务端的路径编码辅助
  map-layout.ts        按轮树的布局计算（lane + 主干优先）
  map-types.ts         会话地图的共享类型
  markdown.ts          共享 markdown 辅助
  model-roles.ts       omp 的模型角色，供浏览器读写
  model-scope.ts       UI 与启动共享的 enabledModels 解析
  npx.ts               skill 安装使用的 npx 运行器
  omp-runtime.ts       共享的 Settings + AuthStorage + ModelRegistry
  omp-types.ts         omp AgentSession 的结构化视图
  project-trust.ts     控制项目可执行资源的开关
  rpc-manager.ts       AgentSessionWrapper + 注册表 + startRpcSession
  session-reader.ts    会话列表 + 路径缓存 + buildSessionContext 适配器
  session-map.ts       .jsonl → 轮次树，并合并 fork 文件
  session-system-prompt.ts  按会话 cwd 解析 SYSTEM.md / APPEND_SYSTEM.md
  session-title.ts     omp 自带标题生成器的薄封装
  tool-presets.ts      PRESET_NONE/DEFAULT/FULL + getPresetFromTools()
  types.ts             共享 TypeScript 类型
  normalize.ts         normalizeToolCalls()：文件格式与本地类型之间的字段名差异
  worktree.ts          项目与 worktree 解析，以及 git worktree 操作

components/
  AccessConfig.tsx    设置弹窗内的密码锁面板
  AppShell.tsx        布局 + URL 状态 + 标签页管理
  SessionSidebar.tsx  会话树
  ChatWindow.tsx      聊天组合 + 完成提示音封装
  ChatInput.tsx       输入栏 + 模型/角色/思考/tools/compact 控件
  MessageView.tsx     渲染单条消息（user/assistant/toolCall/toolResult）
  BranchNavigator.tsx 会话内分支切换器
  ConversationMap.tsx 会话地图：卡片、连线、缩放、分叉与切换
  ChatMinimap.tsx     消息列表旁的滚动缩略图
  MarkdownBody.tsx    markdown 渲染器
  ModelsConfig.tsx    提供方与认证弹窗（从侧栏底部打开）
  ModelRolesPanel.tsx 该弹窗内按角色分配模型
  PluginsConfig.tsx   已安装 omp 插件的弹窗
  SkillsConfig.tsx    已加载、可搜索、可安装 skills 的弹窗
  FileExplorer.tsx    文件树
  FileExplorerPanel.tsx 右侧文件面板内的文件树区（标题、上传、刷新、折叠）
  FileIcons.tsx       文件图标辅助
  FileViewer.tsx      标签页内的文件内容
  TabBar.tsx          标签栏（聊天 + 已打开文件标签）

hooks/
  useAgentSession.ts  消息 + 流式 + SSE + fork/navigate/核对逻辑
  useAudio.ts         完成提示音 + 浏览器 AudioContext 解锁
  useDragDrop.ts      共享拖放状态
  useIsMobile.ts      响应式断点 hook
  useTheme.ts         主题状态
```

---

## 关键设计决策与陷阱

### AgentSession 生命周期（`lib/rpc-manager.ts`）
- 每个会话 id 对应一个 `AgentSessionWrapper`，以 `globalThis.__ompSessions` 为键
- `globalThis` 在 Next.js 热重载后仍然存在；模块级 Map 不行
- 空闲超时 10 分钟。并发的 `startRpcSession()` 调用共享同一个启动 Promise（`globalThis.__ompStartLocks`）
- 扩展通过 omp 自己的 `initializeExtensions()` 绑定，来源
  `@oh-my-pi/pi-coding-agent/modes/runtime-init`，与 `omp --mode rpc` 使用同一套
  接线，上层叠加浏览器实现的 `ExtensionUIContext`。不要重新实现动作集合；
  不一致表现为扩展静默不生效。

### 一个运行时，多个请求（`lib/omp-runtime.ts`）
omp 的 CLI 每个进程构建一次 `Settings` + `AuthStorage` + `ModelRegistry`。
ompdesk 做同样的事并缓存到 `globalThis`；第二个 `AuthStorage` 会在
`~/.omp/agent/agent.db` 上打开第二个 SQLite 句柄并分裂 `credential_disabled`
事件。按项目的设置来自 `settings.cloneForCwd(cwd)`，绝不来自第二个
`Settings.init()`。

任何改动凭据或 `models.yml` 的代码都必须同时调用 `invalidateOmpRuntime()` 与
`invalidateModelsCache()`。

### 模型角色就是模型选择器
omp 按工作范围分配模型（`default`、`smol`、`slow`、`vision`、`plan`、
`designer`、`commit`、`tiny`、`task`、`advisor`），存放在 `config.yml` 的
`modelRoles` 记录中。`lib/model-roles.ts` 读写该记录；`GET /api/models` 返回
解析后的表，`ChatInput` 因此在扁平模型列表上方列出角色，`set_role_model`
切换会话**并记录角色**，使记录与 TUI 中 `/model` 写入的内容一致。

浏览器中的显式模型选择持久化为 `modelRoles.default`
（`lib/startup-preferences.ts`），与 TUI 写入的是同一个位置。

### fork 必须立即销毁 wrapper
`AgentSession.fork()` **原地修改 wrapper 的内部状态**：fork 之后
`inner.sessionId` 是新会话的 id。如果 wrapper 以旧 id 留在注册表中，下一个请求
拿到的是已 fork 的状态，后续 fork 会产生损坏的 `parentSession` 链。

**修复**：`send("fork")` 捕获 `newSessionId`，返回前调用 `this.destroy()`。
原始会话的下一个请求会从原文件重新加载干净的 AgentSession。

### 两种分支，不要混淆
- **Fork**（用户消息上的 Fork 按钮）：创建新的独立 `.jsonl` 文件，通过
  `parentSession` 头字段在侧栏树中显示为子节点。该字段可能写会话 id
  （`fork()`）或绝对路径（`createBranchedSession()`），两种写法都要解析成父行。
- **会话内分支**（Continue 按钮 / BranchNavigator）：在同一文件内调用
  `navigate_tree`。多个条目共享同一个 `parentId`，切换时调用
  `/api/sessions/[id]/context?leafId=`。

### 会话地图（`components/ConversationMap.tsx`）
顶栏「地图」把当前会话画成一棵按轮聚合的树。一个节点是一轮用户提问，连同其后的
助手回答与工具调用；边来自条目的 `parentId`。fork 文件逐字复制父会话的条目，
id 相同，所以跨文件合并时主干只会出现一次，分支从切点长出去。

- 数据每次从 `.jsonl` 现算（`lib/session-map.ts`，按 mtime + 大小缓存），不落
  副本；只有拖动过的卡片坐标写 `localStorage`。
- 子代理会话（位于以父文件名命名的子目录下）不进图，否则单个父会话最多 84 条边。
- 点击卡片只选中；「切到这条线」走现有 `navigate_tree` + `?leafId=` 路径，
  「从这里分叉」发送 `{ type: "fork", entryId, includeEntry: true }`。
- `includeEntry` 让 fork 切在条目本身之后（保留整轮回答），普通 Fork 按钮仍切在
  选中条目的前一个节点。
- 分叉入口默认折叠成一条短枝，卡片底部的按钮展开或收起整棵子树。
- 节点动作发往该节点所属的会话文件；跨文件「切到这条线」先 `navigate_tree`
  再打开那个会话，分叉也在目标文件上执行。
- 切点取这一轮最后一个「没有未完成工具调用」的条目：assistant 文本或配对的
  toolResult，避免新会话带着悬空 toolCall 开始。

### 会话文件可以整体重写
头部的 `parentSession` **只是显示元数据**，对聊天内容没有影响。整文件
`writeFileSync` 是安全的（omp 在迁移时自己就这么做）。删除时级联改挂子节点会
用到。

### `SessionManager.open()` 是异步的
omp 的每个 `SessionManager.open()` / `forkFrom()` / `continueRecent()` 都返回
Promise，`setSessionName()` / `newSession()` / `flush()` 同样。漏掉 `await` 会得到
`Property 'getEntries' does not exist on type 'Promise<…>'`。

### 记录顺序跟随 omp，而非 LLM 上下文
`lib/session-reader.ts` 中的 `buildSessionContext()` 对应 omp 的实时聊天记录
（`{ transcript: true, collapseCompactedHistory: true }`）：被最近一次 compaction
替换的历史会被省略，摘要渲染在**按时间顺序的 compaction 位置**，即保留消息之后、
compaction 之后的轮次之前。它与 LLM 上下文不同，后者把摘要放在开头。`entryIds`
是与 `messages` 平行的数组，在本地遍历，因为 omp 的 `buildSessionContext` 不返回
entry id。

### ToolCall 字段归一化
omp 把 toolCall 块存为 `{type:"toolCall", id, name, arguments}`，
`ToolCallContent` 使用 `{toolCallId, toolName, input}`。`lib/normalize.ts` 的
`normalizeToolCalls()` 处理这个差异，`session-reader.ts`（文件加载）与
`ChatWindow.handleAgentEvent()`（流式）都会调用。

### 新会话的 tools 预设
工具名在创建会话时传入（`POST /api/agent/new` → `toolNames[]`）。已有会话在挂载
时通过 `get_tools` → `getPresetFromTools()` 推断当前预设。完全禁用工具
（`toolNames = []`）时，`rpc-manager.ts` 传入 `toolNames: []` 与
`restrictToolNames: true`，并在启动与重载后强制
`agent.state.systemPrompt = []`。

### `enabledModels` 匹配范围
`enabledModels` 设置使用 omp 的 `--models` 语法：按 `provider/modelId` 或裸
`modelId` 做 glob，非 glob 模式做模糊匹配，可选 `:thinkingLevel` 后缀。不要把这些
模式当字面字符串比较：`lib/model-scope.ts` 委托给 SDK 的 `resolveModelScope()`，
使 ompdesk 与 TUI 对可见模型列表的判断一致；模式解析为空时回退到全部可用模型。
诊断信息由逐个重新解析模式产生，因为 omp 的解析器会静默丢弃未匹配的模式。

### 项目信任由 ompdesk 自己维护
omp 没有信任存储：它运行某个仓库的扩展，因为你选择在那里运行它。浏览器标签页
不能代表这个决定，因此 `lib/project-trust.ts` 在
`~/.omp/agent/ompdesk-trusted-projects.json` 中维护存储，对未信任项目从 omp 发现
的扩展与自定义工具路径中过滤项目内的条目，并禁用 MCP。skills 与 rules 属于数据，
始终加载。见 `docs/project-trust.md`。

### `SYSTEM.md` / `APPEND_SYSTEM.md` 按会话 cwd 解析
`omp` 在创建会话前解析这两个文件，并作为 `customSystemPrompt` /
`appendSystemPrompt` 传入。`startRpcSession()` 自己构建选项，因此
`lib/session-system-prompt.ts` 为浏览器做同样的事：使用 omp 的 `findConfigFile`
（不自己实现查找），先项目再用户级，用 `resolvePromptInput` 读取，用 omp 的
`applyResolvedSystemPromptInputs` 设置字段，文本因此经过 CLI 渲染时使用的同一套
模板。每次查找都绑定会话的 cwd，因为 CLI 的默认值（`getProjectDir()`）在这里是
服务端自己的目录，不是项目的目录。未信任项目同样加载项目内的 prompt 文件：它们
属于数据，与 skills、rules 相同（`docs/project-trust.md`）。

### 流式传输中刷新页面重连 SSE
`ChatWindow` 挂载时调用 `GET /api/agent/[id]`。若 `state.isStreaming === true`，
自动重连 SSE。`thinkingLevel` 与 `isCompacting` 也从该响应同步。

### compaction 的 SSE 事件
较新的 omp 发出 `compaction_start` / `compaction_end`；旧版本发出
`auto_compaction_start` / `auto_compaction_end`。`handleAgentEvent` 同时接受两组
事件，保持 `isCompacting` 同步。手动 compact 是阻塞式 POST，按钮在响应返回前保持
禁用。

### 运行状态轮询与核对
- 标签页可见时，侧栏每 2.5 秒轮询 `/api/agent/running`，后台标签页暂停轮询。
  会话列表响应仍是初始回退。
- 该快照同时返回 `runningSessionIds` 与 `waitingSessionIds`。后者是停在阻塞式
  扩展 UI 请求（`ask` 表单、`select`、`confirm`、`input`、`editor`、`custom`）上、
  等待用户作答的会话：`AgentSessionWrapper.isAwaitingInput()` 按
  `pendingUiRequests` 是否为空判断，等待期间 `isRunning()` 仍为真。侧栏对这类
  会话显示黄灯而不是旋转图标，项目行另行统计黄灯数量。
- `useAgentSession` 把每个会话的 SSE 作为聊天事件的主要来源，并在每次 prompt 前
  打开。`prompt_done` 立即结束当前 UI 阶段与通知，空闲 SSE 保持 30 秒宽限窗口
  并被下一个 prompt 复用。`agent_start` 取消该关闭计时器；`agent_settled` 结束
  由扩展注入、没有 wrapper 级 `prompt_done` 的运行，并开始新的宽限窗口。不要在
  第一个 `agent_end` 时关闭：重试、compaction 与扩展排队的消息可能继续同一个
  逻辑 prompt。
- 运行期间 `useAgentSession` 定期调用 `GET /api/agent/[id]`，并在
  `visibilitychange` / `online` 时核对。这修复后台标签页或半开连接丢失的终止事件。
- prompt 运行使用单调递增的 run id；来自旧运行的迟到 SSE 或慢核对响应必须忽略，
  否则会复活过期的流式气泡。

### worktree 与项目分组
- `lib/worktree.ts` 把 linked worktree 的顶层路径解析回主仓库的 `projectRoot`；
  `listAllSessions()` 把它附加到每个 `SessionInfo`，同一仓库的所有 worktree 在
  侧栏中归为一组。
- worktree 操作由 `/api/worktrees` 提供，使用与 `/api/files` 相同的允许根规则。
- 新 worktree 创建在 `<repoRoot>-worktrees/<sanitized-branch>` 下。已存在的分支
  会被复用；否则 `git worktree add -b` 创建分支。
- 删除有未提交改动的 worktree 返回 `409` 与 `{ dirty: true }`，UI 询问后再以
  `force` 重试。
- cwd 指向已删除 worktree 的会话会被推断回主项目，不产生多余的项目行。

### 文件访问允许列表
- `/api/files` 刻意不是通用文件系统浏览器。允许的根来自会话 cwd、其解析后的项目
  根、`~/omp-cwd-*`，以及通过 `allowFileRoot()` 显式添加的根。
- `/api/cwd/validate`、`/api/default-cwd` 与 `/api/worktrees` 在让新位置可浏览时
  调用 `allowFileRoot()`。

### 插件与 skills
- `/api/plugins` 驱动 omp 的 `PluginManager`（`~/.omp/plugins`）：安装、卸载、
  启用与禁用，并把 `doctor()` 输出作为诊断。omp 没有原地更新，因此 "update" 是
  用 `force` 重装该 spec。
- `/api/skills` 使用 omp 自己的 `loadSkills()`，`.omp/skills`、
  `~/.omp/agent/skills`、`.claude/skills`、插件 skills 与 `.agents/skills` 的
  列出结果与会话看到的一致。
- 切换 skill 只修改目标 `SKILL.md` 的 `disable-model-invocation` frontmatter 键，
  保持局部修改，以保留用户格式。
- `/api/skills/install` 通过 `npx skills add ... --agent claude-code` 执行。
  `skills` CLI 没有 `omp` agent，它的 `pi` agent 写入 `~/.pi/agent/skills`，omp
  **不**读取该路径；默认发现 Claude 布局。

### 认证与模型配置
- 凭据存放在 omp 的 SQLite `agent.db` 中，通过 `AuthStorage` 访问，不在
  `auth.json`。写入走 `authStorage.set()` / `remove()` / `logout()`，使 CLI 与
  ompdesk 共享一个存储与一把锁。
- 提供方列表由能力驱动：`lib/provider-listing-runtime.ts` 把 catalog
  （`@oh-my-pi/pi-catalog`）、OAuth 注册表（`@oh-my-pi/pi-ai/oauth`）与已存凭据
  类型折叠为 `lib/provider-listing.ts` 期望的扁平结构，双认证提供方因此只出现
  一次。`storeCredentialsAs` 与 id 不同的 OAuth 登录，用 catalog 使用的 id 作为键。
- OAuth 流程由 `GET /api/auth/login/[provider]` 通过 `authStorage.login()` 流式
  传输；`onAuth` / `onPrompt` / `onManualCodeInput` 转为浏览器输入请求，短期 token
  存放在 `globalThis.__ompLoginCallbacks`。
- API-key 状态端点绝不返回原始 key。
- `models.yml` 是 YAML：`/api/models-config` 解析 `models.yml` / `models.yaml` /
  `models.json` 中存在的那个，并始终写回 `models.yml`。
- `models.yml` 中指向环境变量的头值写成**裸名称**（`X-Token: MY_VAR`），不写
  `$MY_VAR`。

### 密码访问：在 proxy 中校验，哈希存储，与 `bin/` 共享
`bin/web-auth-store.js` 是密码锁的唯一来源，它位于 `bin/` 且使用 CommonJS 是有意
的：启动器在解析 Bun 之前就需要它，而发布 npm 的 `files` 列表中除 `.next` 外只有
`bin/` 目录，`lib/` 无法承载它。`bin/web-auth-store.d.ts` 是 TypeScript 部分做
类型检查所依据的声明，两者需要同步。

- 密码**只**以 scrypt 摘要形式存放在 `<agentDir>/ompdesk-auth.json`（`0600`，
  原子替换）。没有任何方式读回它，`/recover` 与 `--reset-password` 因此存在。
- `proxy.ts` 运行在 Next.js 16 的 Node.js 运行时（proxy 总是如此），那里可用
  `node:fs` 与 `node:crypto`。**不要**在其中 import omp SDK：`next.config.ts`
  只为服务端构建 externalize `@oh-my-pi/*`，SDK 无法打包。存储因此自行推导 agent
  目录，不调用 `getAgentDir()`。
- `resolveWebAuthPolicy()` 区分凭据文件缺失（未上锁）与不可读
  （`unavailable` -> 503）。不要把两者合并：后者失败开放会静默解锁服务。
- 成功校验缓存五分钟，键为接受该请求的摘要，否则每个请求都会运行 scrypt。键包含
  摘要，密码变更后缓存跨 bundle 失效。
- `/recover` 与 `POST /api/web-access/recovery` 是仅有的未认证路径。它们仍经过
  主机允许列表与跨站检查，恢复码打印在服务端 stdout，绝不出现在响应中。

### 完成提示音
- `hooks/useAudio.ts` 把开关存在 `localStorage` 的 `omp-sound-enabled`，并复用
  同一个 `AudioContext`。
- 浏览器自动播放策略要求声音由用户手势解锁；`ChatInput` 在交互控件中调用解锁
  hook，`ChatWindow` 在 `onAgentEnd` 时播放音调。

### 导出的会话 HTML
- `/api/sessions/[id]/export` 委托 omp 的导出辅助，然后修补生成 HTML 中的递归树
  辅助函数为迭代版本，使极深的线性会话不会让浏览器的调用嵌套溢出。

### HTTP 代理
Bun 的 `fetch` 在**进程启动时读取一次** `HTTP_PROXY` / `HTTPS_PROXY`，且从不代理
loopback，而本地提供方需要 loopback。它忽略 `NO_PROXY`。`lib/http-dispatcher.ts`
在 Bun 下因此是空操作；它的 undici `EnvHttpProxyAgent` 路径只为在 Node 上运行的
开发服务器存在，因为 Bun 把 `undici` 解析为自己的 shim，其中
`setGlobalDispatcher` 不影响 `fetch`，`install` 不存在。

## omp 会话文件格式

位置：`~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"model":"anthropic/claude-sonnet-5","role":"default","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`model_change` 携带 `provider/modelId` 字符串以及来源**角色**；
`SessionContext.models` 是角色 → 选择器的记录，`models.default` 是 UI 显示为会话
模型的项。

---

## CSS 变量（`app/globals.css`）

两套主题都来自 omp 自己的主题文件，`titanium`（omp 默认深色主题）与 `light`，
浏览器与 TUI 因此读起来是同一个产品。

```
--bg --bg-panel --bg-hover --bg-selected --border
--text --text-muted --text-dim
--accent --accent-hover --user-bg --assistant-bg --tool-bg --bg-subtle
--success --danger --warning
--font-mono
```

`--font-mono` 刻意使用系统字体列表：本地优先的工具不得在构建时或运行时从 CDN
拉取字体。

## Agent 入口

`AGENTS.md` 是项目说明的唯一维护来源。`CLAUDE.md` 只保留 `@AGENTS.md` 导入，
Claude Code 因此读取同样的内容。

本文档只写长期成立的规则、命令与结构。规模数字、索引时间、机器绝对路径、具体
会话 id 这类随环境变化的内容不进正文：需要时现场读取（索引统计在
`.gitnexus/gitnexus.json` 的 `stats`）。

索引重建用 `node .gitnexus/run.cjs analyze --index-only`：只更新索引，不写任何
文档。要连带刷新下面这段生成内容，用 `analyze --no-stats`（不带规模数字），它会
把整段恢复为工具输出的英文原文，并同时写进 `CLAUDE.md`，事后需要把 `CLAUDE.md`
还原为 `@AGENTS.md`。`<!-- gitnexus:start -->` 与 `<!-- gitnexus:end -->` 之间
的区段由 GitNexus 生成，长期规则不写在该区段内。

<!-- gitnexus:start -->
# GitNexus 代码索引

本项目由 GitNexus 索引为 **ompdesk**。使用 GitNexus MCP 工具理解代码、评估影响、安全导航。

> 索引过期？在项目根执行 `node .gitnexus/run.cjs analyze --index-only`：只重建索引，不改文档，它会自动选择可用的运行器。还没有 `.gitnexus/run.cjs`？执行 `npx gitnexus analyze`（npm 11 崩溃时执行 `npm i -g gitnexus`；#1939）。

## 必须做到

- **修改任何 symbol 前必须运行影响分析。** 修改函数、类或方法之前，运行 `impact({target: "symbolName", direction: "upstream"})`，并向用户报告影响范围（直接调用方、受影响流程、风险等级）。
- **提交前必须运行 `detect_changes()`**，确认改动只影响预期的 symbol 与执行流程。回归审查时对比默认分支：`detect_changes({scope: "compare", base_ref: "main"})`。
- 影响分析返回 HIGH 或 CRITICAL 风险时，**必须警告用户**，再继续编辑。
- 探索陌生代码时用 `query({query: "concept"})` 查找执行流程，不要用 grep。它按流程分组、按相关度排序返回结果。
- 需要某个 symbol 的完整上下文（调用方、被调用方、参与的流程）时，用 `context({name: "symbolName"})`。

## 绝不

- 修改函数、类或方法前，绝不跳过 `impact`。
- 绝不忽略影响分析的 HIGH 或 CRITICAL 风险警告。
- 绝不用查找替换重命名 symbol，使用 `rename`，它理解调用关系图。
- 绝不跳过 `detect_changes()` 就提交，它检查受影响的范围。

## 资源

| 资源 | 用途 |
|------|------|
| `gitnexus://repo/ompdesk/context` | 代码库概览，检查索引新鲜度 |
| `gitnexus://repo/ompdesk/clusters` | 全部功能区域 |
| `gitnexus://repo/ompdesk/processes` | 全部执行流程 |
| `gitnexus://repo/ompdesk/process/{name}` | 分步执行轨迹 |

## CLI

| 任务 | 阅读的 skill 文件 |
|------|------------------|
| 理解架构 / "X 如何工作？" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| 影响范围 / "改 X 会破坏什么？" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| 追踪 bug / "X 为什么失败？" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| 重命名 / 提取 / 切分 / 重构 | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| 工具、资源、schema 参考 | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| 索引、状态、清理、wiki CLI 命令 | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
