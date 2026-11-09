# 文件表

按路径记录各目录里有什么。这一页是快照：新增、删除或改名文件后同步更新，判定权威
始终是代码本身。完整清单现场取：

```
git ls-files 'app/api/**/route.ts'   # 全部路由
git ls-files lib components hooks     # 其余目录
```

## app/api/

每个网址对应一个 `route.ts`，支持的方法由该文件导出的 `GET`、`POST` 等决定。

```
sessions/route.ts               GET  列出全部会话
sessions/[id]/route.ts          GET/PATCH/DELETE 会话（PATCH 同时管归档）
sessions/[id]/context/route.ts  GET ?leafId= 指定叶节点的上下文
sessions/[id]/state/route.ts    GET 轻量运行态 { running, state }
sessions/[id]/map/route.ts      GET 会话地图（轮次树）；?turn= 取单轮全文
sessions/[id]/auto-name/route.ts POST 生成会话标题
sessions/[id]/export/route.ts   GET 导出会话 HTML
agent/new/route.ts              POST { cwd, ...command } 建会话并执行首条命令
agent/[id]/route.ts             GET 状态 | POST 任意命令
agent/[id]/events/route.ts      GET SSE 流
agent/[id]/bash-output/route.ts GET 命令输出
agent/running/route.ts          GET 运行中与等待输入的会话 id
agent/running/events/route.ts   GET 同一份活动快照的 SSE 流
control/activity/route.ts       GET 后台实例的活动视图，供 ompdesk status 与 stop 读取；只认启动时下发的控制令牌
auth/all-providers/route.ts     GET API-key 提供方列表
auth/api-key/[provider]/route.ts GET/POST/DELETE 提供方 API key 状态与存储
auth/login/[provider]/route.ts  GET OAuth 登录 SSE | POST 手动 code
auth/logout/[provider]/route.ts POST OAuth 登出
auth/providers/route.ts         GET OAuth 提供方列表
cwd/validate/route.ts           POST 校验/选择 cwd
cwd/browse/route.ts             GET 目录选择器
default-cwd/route.ts            POST 创建 ~/omp-cwd-YYYYMMDD
files/[...path]/route.ts        GET 列目录（含 ignored 标记）与文件内容 | POST 上传
file-index/route.ts             GET 文件模糊索引
comment-entries/route.ts        GET 注释词条提取并附带已保存的译文（git 跟踪优先，只读）
comment-dictionary/route.ts     PUT 保存人工译文 | DELETE 删除整个字典
comment-dictionary/lookup/route.ts POST 按字典键批量取译文，供查看器渲染
comment-translations/generate/route.ts POST 按勾选条目生成译文，片段校验后写入字典
git/status/route.ts             GET 工作区改动状态
git/diff/route.ts               GET 单文件差异
home/route.ts                   GET 用户主目录
logs/route.ts                   GET 服务端日志
client-logs/route.ts            POST 浏览器日志上报
mcp/route.ts                    GET/PATCH/PUT MCP 配置
model-roles/route.ts            GET/PUT omp 的 modelRoles 记录
models/route.ts                 GET { models, modelList, defaultModel, roles }
models-config/route.ts          GET/PUT 读写 ~/.omp/agent/models.yml
models-config/catalog/route.ts  GET models.dev 价格预设
models-config/discover/route.ts POST 获取已配置提供方的上游模型列表
models-config/test/route.ts     POST 测试已配置的模型与提供方
plugins/route.ts                GET/POST omp 插件管理
project-trust/route.ts          GET/POST/DELETE 项目信任
settings/route.ts               GET/PATCH 设置面板数据
display-settings/route.ts       GET 渲染相关设置
skills/route.ts                 GET/PATCH 已加载 skills 与 disable-model-invocation
skills/install/route.ts         POST 通过 npx skills add 安装 skills
skills/update/route.ts          POST 升级 skill
skills/search/route.ts          POST 搜索 skill
theme/route.ts                  GET Web 主题调色板
updates/route.ts                GET/POST ompdesk 更新检查与触发
web-access/route.ts             GET/PUT 密码锁（设置 -> 访问）
web-access/recovery/route.ts    POST 恢复码申请与兑换（未认证）
worktrees/route.ts              GET/POST/DELETE git worktree；GET 同时给出本地分支与占用它的副本
```

## lib/

服务端与客户端共用的模块。名称是导出前缀，职责是这一块管什么。

```
agent-client.ts      为 /api/agent 命令提供带类型的 fetch 辅助
api-request-log.ts   withRequestLog：统一请求日志与耗时
comment-entries.ts   注释词条提取：TypeScript 语法树的注释区间、合并连续单行、排除横幅与单词标题、含中文即归中文、计算字典键
comment-sources.ts   词条来源文件：git 仓库以 .gitignore 为准，非仓库退回目录遍历
comment-dictionary.ts 本机注释字典：按键读写人工译文、来源标记、只返回当前项目相关记录
comment-dictionary-version.ts 字典版本号与订阅，保存译文后通知查看器刷新
comment-translation-preference.ts 查看器译文开关的本机存储与订阅
comment-translation-render.ts 译文行计算：界面语言对应的目标语言、查询键去重、按源码行号挂译文
comment-translation-request.ts 生成请求的共享上限与失败码到提示文案的映射
comment-translation-generation.ts 勾选条目的批量译文生成：字典命中、force 覆盖、分批提示词、逐条校验与写入
comment-translation-validation.ts 译文逐字片段校验：路径、标识符、数字与括号片段
comment-translation-route.ts 生成接口的请求校验与处理器
comment-translation-model.ts 生成接口的模型接线：可见模型选择与 completeSimple 调用
control-activity.ts 按工作区汇总会话数、运行中与等待输入，供 /api/control/activity 使用；工作区键与侧边栏同一规则
control-token.ts     后台实例的控制令牌：请求头名、路径前缀与常量时间比较
git-env.ts           createGitEnv()：git 子进程环境，剥离钩子注入的仓库定位变量
git-ignore.ts        checkIgnoredEntries：git check-ignore 批量判定目录项是否被忽略，不可判定返回 null
git-listing.ts       listGitFiles：git ls-files 列举跟踪与未忽略的文件，非仓库返回 null
request-security.ts  请求来源与主机校验
source-wrap-preference.ts 源码视图换行开关的共享状态，查看器与预览共用
logging.ts           服务端日志入口
memory-monitor.ts    进程内存采样：process.memory 记录的数据来源
sse-lifecycle.ts     两条 SSE 路由共用的连接生命周期
http-dispatcher.ts   代理环境变量接线的运行时分支
web-auth.ts          密码锁的读取方
allowed-roots.ts     allowFileRoot() 与额外允许根
path-security.ts     路径越界判定
draft-store.ts       内存草稿表（刷新即失效）
file-access.ts       /api/files 与 worktree 允许的文件根
file-paths.ts        客户端与服务端的路径编码辅助
image-zoom.ts        图片缩放的几何计算（适配、锚点缩放、边界收敛）
map-layout.ts        按轮树的布局计算（lane + 主干优先）
map-types.ts         会话地图的共享类型
markdown.ts          共享 markdown 辅助
model-roles.ts       omp 的模型角色，供浏览器读写
model-scope.ts       UI 与启动共享的 enabledModels 解析
model-catalog.ts     models.dev 目录与价格
npx.ts               skill 安装使用的 npx 运行器
omp-runtime.ts       共享的 Settings + AuthStorage + ModelRegistry
omp-types.ts         omp AgentSession 的结构化视图
project-trust.ts     控制项目可执行资源的开关
rpc-manager.ts       AgentSessionWrapper + 注册表 + startRpcSession
session-reader.ts    会话列表 + 路径缓存 + buildSessionContext 适配器
session-marker.ts    侧栏标记判定、播种集合与运行结束的归属（纯函数）
session-unread.ts    未读会话集合的共享状态、订阅与本机持久化
session-map.ts       .jsonl → 轮次树，并合并 fork 文件
session-archive.ts   归档标记读写
session-system-prompt.ts  按会话 cwd 解析 SYSTEM.md / APPEND_SYSTEM.md
session-title.ts     omp 自带标题生成器的薄封装
telemetry.ts         OTLP 导出：进程内注册一次 provider，每会话给配置，轮末 flush
transcript-follow.ts 跟随开关的判定：提交与回到底部的处置、跳转停跟随、滚动位置的观测
transcript-items.ts  把消息数组切成“一轮一项”的扁平条目：锚点、可见过程消息、正式回答与尾部
transcript-live-tail.ts 把流式消息作为列表末尾的合成项接到条目数组，键与定位和条目同源
transcript-rail.ts   提问跳转条的几何：落位与隐藏阈值、圆点、当前轮、压缩节距与逐轮步进
transcript-rail-jump.ts 跳转的待清算目标：列表停稳或兜底到期时按实测高度只重新对齐一次
transcript-view-state.ts 按会话与轮锚点保存过程组/工具块的展开状态与已取回的延迟内容正文
transcript-virtual-list.ts 虚拟列表要的条目键与首屏定位，以及跟随输出开关
skills-service.ts    loadSkills 与会话一致性的封装
goal-mode.ts         目标模式状态机
git-changes.ts       工作区改动状态与单文件差异
workspace-memory.ts  标签页续接
tool-presets.ts      PRESET_NONE/DEFAULT/FULL + getPresetFromTools()
types.ts             共享 TypeScript 类型
normalize.ts         normalizeToolCalls()：文件格式与本地类型之间的字段名差异
worktree.ts          项目解析、本地分支清单、按分支确保工作副本与增删
worktree-types.ts    /api/worktrees 的 checkout 与本地分支类型，侧栏与 Git 面板共用
worktree-switch.ts   分支切换请求的发布与订阅：Git 面板发起，侧栏执行目录解析
coverage-gate/       覆盖率门禁，见下方
```

### lib/coverage-gate/

合并检查用的覆盖率与导出引用判定。判定输入是两份 lcov、一份改动清单与一次源码扫描，
不联网、不读写 agent 目录。规则与入口见 `docs/coverage-gate.md`。

```
cli.ts              判定入口：runCoverageGate（规则一、二）与 runExportGate（规则三），退出码 0/1/2
lcov.ts             解析 lcov：反斜杠路径、?mtime= 去重、仓库外记录剔除、加权合计
git.ts              git 查询：改动清单（含未跟踪）、受管源文件、生产引用来源、分叉点
base-coverage.ts    分叉点基准：临时工作副本 + 同一条测试命令产出 lcov，读完即删
function-names.ts   两版文件的函数名集合：定义、重导出与差集
test-imports.ts     测试文件的导入索引，供被动覆盖的静态检查
test-command.ts     测试命令、覆盖率产物路径与运行环境的唯一定义
source-scan.ts      TypeScript 语法树解析入口：扩展名到 ScriptKind、导入候选后缀
exports.ts          导出符号提取与引用索引（含转出口与命名空间导入）
export-usage.ts     一次导出引用判定的数据采集：新增导出、引用索引、基线
export-baseline.ts  基线文件格式与按分叉点生成
framework-exports.ts 框架按文件名或路径调用的导出白名单
exceptions.ts       豁免清单解析、校验与生效判定
report.ts           报告渲染：覆盖率报告与静态引用检查报告
rules/              三条规则与失真处理（改名、拆分、合并、替换）
```

## components/

界面组件。一个组件对应屏幕上一块可见区域，职责写它渲染什么。

```
AccessConfig.tsx    设置面板内的密码锁
SettingsConfig.tsx  设置面板宿主，内嵌模型、skills、插件、密码锁与日志
AppShell.tsx        布局 + URL 状态 + 标签页 + 完成提示音
SessionSidebar.tsx  会话树
ChatWindow.tsx      聊天组合
ChatInput.tsx       输入栏 + 模型/角色/思考/tools/compact 控件
MessageView.tsx     渲染单条消息（user/assistant/toolCall/toolResult）
ConversationMap.tsx 分支地图：卡片、连线、缩放、弹窗详情、分叉与切换
SubagentPanel.tsx   子代理标签页：运行与历史列表、执行详情
CommentTranslationPanel.tsx 注释互译标签页：中英两栏词条、勾选生成、分批请求与字典管理
CommentTranslationPreview.tsx 面板底部预览：用查看器同一份源码视图渲染选中词条
SourceCodeView.tsx  源码渲染：高亮、行号、换行与译文行，查看器与预览共用
RewindDialog.tsx    回退选点对话框
ProjectTrustDialog.tsx 项目信任确认
ExtensionStatusBar.tsx 扩展状态栏
LogsPanel.tsx       服务端日志面板
MermaidBlock.tsx    mermaid 与代码块渲染
MarkdownBody.tsx    markdown 渲染器
MarkdownImage.tsx   markdown 图片：本地路径改走文件接口后交给缩放入口
ImageZoom.tsx       图片缩放画面、全屏预览层与可点击图片入口
ModelsConfig.tsx    设置面板内的提供方与认证
ModelRolesPanel.tsx 设置面板内按角色分配模型
PluginsConfig.tsx   设置面板内的插件管理
SkillsConfig.tsx    设置面板内的 skills 列表与安装
FileExplorer.tsx    文件树
FileExplorerPanel.tsx 右侧标签页中的文件树视图（上传、刷新、变更文件）
GitChangesPanel.tsx 右侧标签页中的 Git 变更列表（状态、汇总、刷新与轮询）
WorktreeSwitcher.tsx Git 标签页顶部的分支下拉：当前分支、切换 checkout 与新建 worktree
PathLabel.tsx       路径标签：左端省略并保留结尾路径段，Git 面板的 checkout 行使用
GitStatusBadge.tsx  变更文件的状态字母徽标与状态配色
PanelIconButton.tsx 右侧面板工具栏图标按钮
FileIcons.tsx       文件图标辅助
PanelViewIcon.tsx   视图标签与入口的图标
FileViewer.tsx      文件标签页的内容
TabBar.tsx          右侧面板标签栏（文件浏览器 / Git / 子代理 / 注释互译 / 已打开文件）
TurnWrittenFiles.tsx 单轮写入文件列表
TranscriptRail.tsx  对话列右外侧的提问跳转条：圆点、悬停提示、上一条与下一条
```

## hooks/

浏览器侧状态与副作用封装。职责写它订阅或维护哪份状态。

```
useAgentSession.ts  消息 + 流式 + SSE + fork/navigate/核对逻辑
useAudio.ts         完成提示音 + 浏览器 AudioContext 解锁
useDragDrop.ts      共享拖放状态
useIsMobile.ts      响应式断点 hook
useResizablePanel.ts 面板拖拽宽度
useKeyboardShortcuts.ts 全局快捷键
useDisplaySettings.ts 渲染设置
useI18n.tsx         全站翻译上下文
useCommentTranslation.ts 译文开关、字典版本与按键批量查询
useSourceWrapLines.ts 源码换行开关，订阅共享状态
useTheme.ts         主题状态
```

## 根目录

不在上述四组里、但改代码时会碰到的入口与配置。

```
proxy.ts            访问控制：密码校验、主机与跨站检查；控制令牌通道在这里放行
instrumentation.ts  启动时接线（代理、日志）
next.config.ts      构建配置：@oh-my-pi/* externalize、distDir
bin/                启动器（start/status/stop/foreground）、实例记录、密码存储、Bun 定位
scripts/            开发辅助（scratch 建临时目录、smoke-dev 开发冒烟、check-commit-msg 校验提交信息、pr-queue 列开放 PR 的阻塞项、coverage-gate 覆盖率门禁入口）
test-support/       测试样本：会话夹具经 SessionManager 生成，测试与手工验证共用同一入口
coverage-exceptions.json    覆盖率门禁的豁免清单（path、rule、reason、alternativeVerification、expires）
coverage-export-baseline.json 分叉点之前就存在的无引用导出，规则三据此不重复拦存量
```
