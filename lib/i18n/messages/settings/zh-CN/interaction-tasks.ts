/** omp 设置面板 interaction 与 tasks 标签的简体中文文案。 */
export const interactionTasks: Record<string, string> = {
  "settings.group.interaction.input": "输入",
  "settings.group.interaction.approvals": "审批",
  "settings.group.interaction.notifications": "通知",
  "settings.group.interaction.speech": "语音",
  "settings.group.interaction.collab": "协作",
  "settings.group.interaction.stream": "直播",
  "settings.group.interaction.magic-keywords": "魔法关键词",
  "settings.group.interaction.startup-updates": "启动与更新",
  "settings.group.interaction.power": "电源",
  "settings.group.interaction.agent": "Agent",
  "settings.group.interaction.git": "Git",
  "settings.group.interaction.skills": "技能",
  "settings.group.tasks.modes": "模式",
  "settings.group.tasks.subagents": "子代理",
  "settings.group.tasks.isolation": "隔离",
  "settings.group.tasks.commands-skills": "命令与技能",

  "settings.field.steeringMode.label": "引导模式",
  "settings.field.steeringMode.description": "Agent 正在工作时如何处理已排队的消息",
  "settings.field.followUpMode.label": "后续消息模式",
  "settings.field.followUpMode.description": "一轮结束后如何排空后续消息",
  "settings.field.interruptMode.label": "打断模式",
  "settings.field.interruptMode.description": "引导消息何时打断工具执行",
  "settings.field.tui.vimMode.label": "Vim 编辑模式",
  "settings.field.tui.vimMode.description":
    "模态提示符编辑。Esc 退出插入模式；普通模式支持 hjkl、0、$、^、w、b、e、gg、G、计数、x/D/C、dd/yy、p 与 u；操作符可搭配移动或文本对象（diw、ca(、dap）；v/V 开始可视选区，y 复制，d 删除",
  "settings.field.tui.vimModeDisplay.label": "Vim 模式指示器",
  "settings.field.tui.vimModeDisplay.description": "当前 Vim 模式在状态行中的显示方式",
  "settings.field.loop.mode.label": "循环模式",
  "settings.field.loop.mode.description": "重新提交提示词之前，/loop 各次迭代之间执行什么",
  "settings.field.loop.conditionTimeoutMs.label": "循环条件超时（ms）",
  "settings.field.loop.conditionTimeoutMs.description":
    "`/loop --while` / `--until` 条件命令的最长等待时间，超过即视为异常并停止循环。设为 0 表示无限等待",
  "settings.field.composer.recallClearedDrafts.label": "回忆已清空的草稿",
  "settings.field.composer.recallClearedDrafts.description":
    "用 Ctrl+C 清空的草稿会保留在本地上/下键历史中直到退出；关闭只影响之后的清空操作",
  "settings.field.doubleEscapeAction.label": "双 Esc 行为",
  "settings.field.doubleEscapeAction.description":
    "编辑器为空时连按两次 Esc 的行为：打开对话回退选择器、打开会话树，或不做任何事",
  "settings.field.input.bareExitOnEmptySession.label": "空会话直接退出",
  "settings.field.input.bareExitOnEmptySession.description":
    "首条消息之前输入 `exit`、`quit` 或 `q`（不区分大小写）时直接退出，而不是发给模型",
  "settings.field.input.bareSlashCommands.label": "省略斜杠的命令",
  "settings.field.input.bareSlashCommands.description":
    "直接输入命令名（不带前导 `/`，如 `model`、`compact`）即执行对应的斜杠命令；会话已有消息时需按两次 Enter 确认",
  "settings.field.treeFilterMode.label": "会话树过滤",
  "settings.field.treeFilterMode.description": "打开会话树时默认使用的过滤模式",
  "settings.field.autocompleteMaxVisible.label": "自动补全条目数",
  "settings.field.autocompleteMaxVisible.description": "自动补全下拉列表中最多显示的条目数（3-20）",
  "settings.field.spelling.typoDetection.label": "拼写错误检测（macOS）",
  "settings.field.spelling.typoDetection.description": "使用当前 macOS 词典标记提示词中的拼写错误",
  "settings.field.spelling.autocomplete.label": "单词自动补全",
  "settings.field.spelling.autocomplete.description":
    "以内联提示显示预测的单词补全：Tab 接受并补一个空格，右方向键接受但不补空格",
  "settings.field.composer.predictions.label": "输入框预测",
  "settings.field.composer.predictions.description":
    "每完成一轮后，请当前模型预测你的下一条消息，并在空的输入框中以幽灵文本显示；Tab 或右方向键插入但不发送。额外用量：每完成一轮都会对整段对话多发一次计费请求（计入 /stats）",
  "settings.field.spelling.autocorrect.label": "自动纠错（macOS）",
  "settings.field.spelling.autocorrect.description": "单词输入完成后应用 macOS 有把握的拼写纠正",
  "settings.field.emojiAutocomplete.label": "Emoji 自动补全",
  "settings.field.emojiAutocomplete.description":
    "根据 `:name:` 短代码提示 emoji，并展开 `:D`、`:-)` 之类的文字表情",
  "settings.field.paste.largeMenuThreshold.label": "大段粘贴菜单",
  "settings.field.paste.largeMenuThreshold.description":
    "粘贴内容达到这么多行时，提供菜单将其包成代码块、包进 XML 标签，或保存到文件。0 关闭该菜单（大段粘贴仍会折叠为 [Paste] 标记）。",

  "settings.field.tools.approval.label": "工具审批策略",
  "settings.field.tools.approval.description":
    "按工具设置的审批策略。设为 'allow' 自动批准，'prompt' 要求确认，'deny' 阻止。覆盖设置在每种审批模式下都生效。",
  "settings.field.tools.approvalMode.label": "工具审批",
  "settings.field.tools.approvalMode.description":
    "工具调用的默认审批行为。'Always ask' 只自动批准只读工具。'Write' 自动批准读取与工作区写入工具。'Yolo' 自动批准所有层级；用户策略仍可能要求确认或阻止。",

  "settings.field.completion.notify.label": "完成通知",
  "settings.field.completion.notify.description": "Agent 完成一轮时通知",
  "settings.field.error.notify.label": "错误通知",
  "settings.field.error.notify.description": "Agent 因错误停止时通知",
  "settings.field.ask.timeout.label": "询问超时",
  "settings.field.ask.timeout.description":
    "经过这么多秒后自动选择推荐的询问选项（0 表示关闭）。同样限制 cfg:// 审批提示的等待；审批无响应时会拒绝写入，而不是自动选择",
  "settings.field.ask.notify.label": "询问通知",
  "settings.field.ask.notify.description": "ask 工具等待输入时通知",
  "settings.field.recap.enabled.label": "空闲回顾",
  "settings.field.recap.enabled.description": "终端空闲一段时间后，让 LLM 生成当前进展的简要回顾",
  "settings.field.recap.idleSeconds.label": "空闲回顾延迟",
  "settings.field.recap.idleSeconds.description": "显示回顾前需要空闲等待的秒数",

  "settings.field.stt.enabled.label": "语音转文字",
  "settings.field.stt.enabled.description": "启用通过麦克风的语音转文字输入",
  "settings.field.stt.submitTrigger.label": "语音转文字提交时机",
  "settings.field.stt.submitTrigger.description":
    "选择语音听写何时自动提交：从不、松开（2 个词以上）、松开且句子完整，或当我说提交时。",

  "settings.field.collab.relayUrl.label": "中继 URL",
  "settings.field.collab.relayUrl.description": "/collab 使用的中继（wss://host[:port]）",
  "settings.field.collab.webUrl.label": "Web UI URL",
  "settings.field.collab.webUrl.description":
    "/collab 链接使用的浏览器界面；留空则从 collab.relayUrl 推导；显式 http:// 仅限本机",
  "settings.field.collab.displayName.label": "显示名称",
  "settings.field.collab.displayName.description": "展示给其他协作参与者的名称（默认：系统用户名）",
  "settings.field.collab.autoStart.label": "自动启动",
  "settings.field.collab.autoStart.description":
    "每个交互会话启动时都通过 collab.relayUrl 托管，并登记到本地注册表（omp collab list）；切换会话时房间会轮换",
  "settings.field.share.serverUrl.label": "分享服务器",
  "settings.field.share.serverUrl.description":
    "/share 使用的分享查看器/上传基础地址（加密 blob 上传 + 查看器；链接形如 <base>/<id>#<key>）",
  "settings.field.share.store.label": "分享存储",
  "settings.field.share.store.description": "/share 上传加密会话 blob 的目标位置",
  "settings.field.share.redactSecrets.label": "分享密钥脱敏",
  "settings.field.share.redactSecrets.description":
    "上传前对 /share 快照执行密钥混淆处理（使用 secrets.* 配置）",

  "settings.field.stream.serverUrl.label": "直播服务器",
  "settings.field.stream.serverUrl.description":
    "`omp stream` 使用的直播服务器（https://host[:port]）；观看者通过 <base>/<你的 Stencil 用户名> 观看",

  "settings.field.magicKeywords.enabled.label": "魔法关键词",
  "settings.field.magicKeywords.enabled.description":
    "为单独出现的 ultrathink、orchestrate、workflowz、jevify 关键词启用隐藏提示",
  "settings.field.magicKeywords.ultrathink.label": "Ultrathink 关键词",
  "settings.field.magicKeywords.ultrathink.description":
    "允许单独出现的 ultrathink 请求最高自动思考等级，并附加其隐藏提示",
  "settings.field.magicKeywords.orchestrate.label": "Orchestrate 关键词",
  "settings.field.magicKeywords.orchestrate.description":
    "允许单独出现的 orchestrate 附加其隐藏的多 Agent 编排提示",
  "settings.field.magicKeywords.workflow.label": "Workflow 关键词",
  "settings.field.magicKeywords.workflow.description":
    "允许单独出现的 workflowz 附加其隐藏的 eval 工作流提示",
  "settings.field.magicKeywords.jevify.label": "Jevify 关键词",
  "settings.field.magicKeywords.jevify.description":
    "允许单独出现的 jevify 附加其隐藏的批量评判分类提示",

  "settings.field.autoResume.label": "自动恢复",
  "settings.field.autoResume.description": "自动恢复当前目录下最近的会话",
  "settings.field.startup.quiet.label": "安静启动",
  "settings.field.startup.quiet.description": "跳过欢迎界面与启动状态消息",
  "settings.field.startup.showSplash.label": "显示启动画面",
  "settings.field.startup.showSplash.description":
    "正常交互启动时显示完整的动画启动画面，且不会重跑安装向导。开启安静启动时仍会隐藏它。",
  "settings.field.startup.setupWizard.label": "安装向导",
  "settings.field.startup.setupWizard.description": "每个安装配置版本展示一次新增的入门步骤",
  "settings.field.startup.checkUpdate.label": "检查更新",
  "settings.field.startup.checkUpdate.description": "启动时检查 omp 更新",
  "settings.field.update.channel.label": "更新通道",
  "settings.field.update.channel.description": "`omp update` 与启动更新检查使用的更新通道",
  "settings.field.marketplace.autoUpdate.label": "市场自动更新",
  "settings.field.marketplace.autoUpdate.description": "启动时检查插件更新",
  "settings.field.startup.changelogMode.label": "启动更新日志",
  "settings.field.startup.changelogMode.description":
    "选择更新说明以摘要、完整内容显示，或保持隐藏",

  "settings.field.power.sleepPrevention.label": "阻止休眠",
  "settings.field.power.sleepPrevention.description":
    "会话活跃期间阻止系统休眠。每个级别是累积的，会包含所有更低级别的标志。",

  "settings.field.features.unexpectedStopDetection.label": "异常停止",
  "settings.field.features.unexpectedStopDetection.description":
    "助手没有可见消息就停止时自动恢复。Smart 还会用小模型对纯文本停止进行分类。",

  "settings.field.git.enabled.label": "启用 Git 集成",
  "settings.field.git.enabled.description":
    "在 TUI 中显示 git 分支、状态与 PR 信息，并监听仓库元数据。",

  "settings.field.skills.registryUrl.label": "技能注册中心",
  "settings.field.skills.registryUrl.description":
    "`omp skill` 用于安装、搜索与发布技能的 Skillshare 注册中心（https://host[:port]）",

  "settings.field.task.isolation.enabled.label": "隔离子代理",
  "settings.field.task.isolation.enabled.description":
    "在检出的隔离副本中运行子代理，之后再整合它们的改动",
  "settings.field.isolation.backend.label": "隔离后端",
  "settings.field.isolation.backend.description": "用于子代理隔离与 worktree 克隆的后端",
  "settings.field.worktree.clone.label": "将检出克隆到 worktree",
  "settings.field.worktree.clone.description":
    "由 `github pr_checkout` 与 bash 中的 `git worktree add` 新建的 worktree 会以当前检出的写时复制克隆为起点，使被忽略的构建产物（node_modules、target）一并带过来；文件系统无法克隆时退回普通检出",
  "settings.field.worktree.cleanSource.label": "/wt 时清理源检出",
  "settings.field.worktree.cleanSource.description":
    "用 `/wt` 创建 worktree 时，在把改动带过去之后重置原检出的已跟踪改动并删除未跟踪文件",
  "settings.field.worktree.onStart.label": "启动时使用 worktree",
  "settings.field.worktree.onStart.description": "新的交互会话是否在新建的链接 worktree 中启动",
  "settings.field.worktree.onExit.label": "退出时处理 worktree",
  "settings.field.worktree.onExit.description":
    "退出时如何处理自 omp 启动以来创建的 worktree（启动时创建或用 `/wt` 创建）",
  "settings.field.task.isolation.apply.label": "应用隔离改动",
  "settings.field.task.isolation.apply.description":
    "自动把成功的隔离任务改动应用到父检出；关闭则保留补丁或分支产物",
  "settings.field.task.isolation.merge.label": "隔离合并策略",
  "settings.field.task.isolation.merge.description":
    "隔离任务的改动如何整合（应用补丁或合并分支）",
  "settings.field.task.isolation.commits.label": "隔离提交风格",
  "settings.field.task.isolation.commits.description":
    "嵌套仓库改动的提交信息风格（通用或 AI 生成）",
  "settings.field.worktree.base.label": "Worktree 基础目录",
  "settings.field.worktree.base.description":
    "Agent 管理的 worktree 的基础目录——任务隔离副本、`github` PR 检出与 `omp worktree` 清理都放在这里。未设置时使用 ~/.omp/wt。必须是绝对路径或 ~ 相对路径；相对路径会被忽略。环境变量 OMP_WORKTREE_DIR 会覆盖此设置。",

  "settings.field.task.eager.label": "偏好任务委派",
  "settings.field.task.eager.description": "推动把工作委派给子代理的力度",
  "settings.field.task.batch.label": "批量任务调用",
  "settings.field.task.batch.description":
    "把 task 工具切换到批量形态：一次调用携带 { context, tasks[] } —— 每个条目一个子代理，可为每个条目指定可选的 agent（默认使用会话的 spawn 策略 agent）、按条目隔离，并把必填的共享 context 前置到每个任务。当 async.enabled=true 时，每次 spawn 都作为独立的后台 Agent 运行，遵循常规的 idle/parked 生命周期；否则调用会阻塞到返回合并结果。关闭后恢复扁平的单次 spawn 结构。",
  "settings.field.task.structured.label": "结构化任务结果",
  "settings.field.task.structured.description":
    "在 task 工具上开放 outputSchema/schemaMode，并通过 yield 工具返回子代理结果，按调用方或 agent 的输出 schema 校验。关闭时：task 子代理没有 yield 工具，以纯文本返回最终消息。Eval 的 agent()/workpool spawn 始终保留结构化结果。",
  "settings.field.task.speculativeLaunch.label": "预测式任务启动",
  "settings.field.task.speculativeLaunch.description":
    "批量调用中，每个 tasks[] 条目流式输出结束就立即启动对应子代理，不再等待整个 task 调用完成。若已完成的调用校验失败、被阻止或参数发生变化，已启动的 Agent 会被中止。需要 task 审批为自动允许，且没有扩展工具生命周期处理器。",
  "settings.field.task.enableEffort.label": "按任务设置 effort",
  "settings.field.task.enableEffort.description":
    "在 task spawn 上开放可选的 effort 参数，允许调用方覆盖每个子代理的思考级别",
  "settings.field.task.maxConcurrency.label": "最大并发任务数",
  "settings.field.task.maxConcurrency.description": "同时运行的子代理数量上限",
  "settings.field.task.enableLsp.label": "子代理中的 LSP",
  "settings.field.task.enableLsp.description":
    "允许通过 task 工具启动的子代理使用 lsp 工具。默认关闭以控制子代理开销；当带 LSP 的委派值得额外 Token 时再开启。",
  "settings.field.task.maxRecursionDepth.label": "最大任务递归深度",
  "settings.field.task.maxRecursionDepth.description": "子代理可以再启动子代理的层数",
  "settings.field.task.maxRuntimeMs.label": "子代理最长运行时间",
  "settings.field.task.maxRuntimeMs.description":
    "每个子代理的硬性实际耗时上限（ms）。0 表示不限。用于纵深防御服务商侧绕过推理层看门狗的流挂起；超时会以 'timed out' 原因触发正常的子代理中止。",
  "settings.field.task.completionProbe.label": "子代理完成度探测",
  "settings.field.task.completionProbe.description":
    "通过类似 /btw 的缓存旁路请求，让正在工作的子代理估算任务完成度：在 2、5、10、30 分钟后各询问一次，之后每小时一次。估算结果会显示在 wait 与 task 视图中子代理旁边。只询问交互式会话主 Agent 启动的子代理；print、RPC、ACP 与 SDK 运行从不探测。",
  "settings.field.task.softRequestBudget.label": "子代理软请求预算",
  "settings.field.task.softRequestBudget.description":
    "每个子代理的软请求预算（每次运行的助手请求数）。超过后会注入一条收尾引导提示（见 task.softRequestBudgetNotice）；达到预算的 1.5 倍时强制停止本次运行，agent 必须交回已有发现。0 表示关闭该保护。内置的 scout/sonic agent 上限更低，因此低于该上限的值对它们依然生效。task.agentSoftRequestBudget 中针对某个 agent 的条目会替换此预算。",
  "settings.field.task.softRequestBudgetNotice.label": "软请求预算提示",
  "settings.field.task.softRequestBudgetNotice.description":
    "子代理超过软请求预算时注入一条引导提示，要求它在 1.5 倍强制停止前收尾。",
  "settings.field.task.maxEffort.label": "最大单次 spawn effort",
  "settings.field.task.maxEffort.description":
    "task 工具按 spawn 传递的 effort 提示所允许的最高推理强度。较低的值可防止调用方把子代理提升到该上限之上；默认保留模型的完整范围。",
  "settings.field.task.prewalk.label": "通用任务 prewalk",
  "settings.field.task.prewalk.description":
    "为内置的通用 `task` 子代理启用 prewalk：它在解析出的模型上启动，先规划并开始实现，然后在第一次 edit/write 时移交给 'smol' 角色。按 agent 的覆盖设置（task.agentPrewalk，在 /agents 中心配置）以及用户 agent 的 `prewalk` frontmatter 不受此开关影响，始终生效。",

  "settings.field.plan.enabled.label": "计划模式",
  "settings.field.plan.enabled.description": "启用计划模式，在执行前进行只读探索与规划",
  "settings.field.plan.defaultOnStartup.label": "启动时进入计划模式",
  "settings.field.plan.defaultOnStartup.description": "每个新会话开始时自动进入计划模式",
  "settings.field.plan.autosave.label": "自动保存计划",
  "settings.field.plan.autosave.description": "计划模式结束时自动把已批准的计划保存到磁盘",
  "settings.field.plan.autosaveDir.label": "自动保存目录",
  "settings.field.plan.autosaveDir.description":
    "自动保存计划的目录。支持 ~、绝对路径与相对于 CWD 的路径。留空则使用 <project>/.omp/plans/。",
  "settings.field.goal.enabled.label": "目标模式",
  "settings.field.goal.enabled.description": "启用按会话的目标模式与隐藏的 goal 工具",
  "settings.field.goal.statusInFooter.label": "状态行中的目标状态",
  "settings.field.goal.statusInFooter.description": "在状态行的目标指示器旁显示 Token 预算",
  "settings.field.title.generator.label": "标题生成器",
  "settings.field.title.generator.description": "根据用户消息为未命名会话生成名称的方式",
  "settings.field.title.refreshOnReplan.label": "重新规划时刷新标题",
  "settings.field.title.refreshOnReplan.description":
    "todo 初始化重新规划后刷新生成的会话标题，用户手动设置的标题除外",

  "settings.field.skills.enableSkillCommands.label": "技能命令",
  "settings.field.skills.enableSkillCommands.description": "把技能注册为 /skill:name 命令",
  "settings.field.commands.enableClaudeUser.label": "Claude 用户命令",
  "settings.field.commands.enableClaudeUser.description": "从 ~/.claude/commands/ 加载命令",
  "settings.field.commands.enableClaudeProject.label": "Claude 项目命令",
  "settings.field.commands.enableClaudeProject.description": "从 .claude/commands/ 加载命令",
  "settings.field.commands.enableOpencodeUser.label": "OpenCode 用户命令",
  "settings.field.commands.enableOpencodeUser.description":
    "从 ~/.config/opencode/commands/ 加载命令",
  "settings.field.commands.enableOpencodeProject.label": "OpenCode 项目命令",
  "settings.field.commands.enableOpencodeProject.description": "从 .opencode/commands/ 加载命令",
};
