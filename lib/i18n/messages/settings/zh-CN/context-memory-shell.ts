/** shell、context 与 memory 标签的简体中文文案。 */
export const contextMemoryShell: Record<string, string> = {
  "settings.group.shell.bash": "Bash",
  "settings.group.shell.eval-runtimes": "Eval 与运行时",

  "settings.field.bash.enabled.label": "Bash",
  "settings.field.bash.enabled.description": "启用 bash 工具以执行 Shell 命令",
  "settings.field.bash.allowCompoundCommands.label": "允许复合命令",
  "settings.field.bash.allowCompoundCommands.description":
    "按命令逐个求值字面量 && 链；未匹配的命令沿用常规 bash 审批策略与模式",
  "settings.field.bash.autoBackground.enabled.label": "Bash 自动转后台",
  "settings.field.bash.autoBackground.enabled.description":
    "自动将长时间运行的 bash 命令转入后台，稍后投递结果",
  "settings.field.bash.gitGuard.label": "Git 守卫",
  "settings.field.bash.gitGuard.description":
    "在 bash 工具中拒绝会丢弃或移动他人成果的 git 命令：stash、reset --hard 或 reset 到其他提交，以及在非 merge/rebase 冲突期间执行 checkout/switch/restore",
  "settings.field.bashInterceptor.enabled.label": "Bash 拦截器",
  "settings.field.bashInterceptor.enabled.description": "拦截已有专用工具的 Shell 命令",
  "settings.field.bash.direnv.label": "direnv 自动加载",
  "settings.field.bash.direnv.description":
    "将仓库的 direnv/devenv `.envrc` 自动加载进 bash 会话，无需手动 `direnv exec` 即可使用 devenv 工具与环境变量。遵循 direnv 的允许列表：未执行 `direnv allow` 的 `.envrc` 绝不会被执行",

  "settings.field.shellMinimizer.enabled.label": "Shell 输出精简",
  "settings.field.shellMinimizer.enabled.description":
    "在把冗长的 Shell 输出（git、npm、cargo 等）返回给 Agent 前先压缩",
  "settings.field.shellMinimizer.sourceOutlineLevel.label": "Shell 精简源码大纲",
  "settings.field.shellMinimizer.sourceOutlineLevel.description":
    "以 cat/read 读取源码文件时的大纲模式：default 或 aggressive",
  "settings.field.eval.py.label": "Python Eval 后端",
  "settings.field.eval.py.description": "允许 eval 工具把 Python 单元格派发给 IPython 内核",
  "settings.field.eval.js.label": "JavaScript Eval 后端",
  "settings.field.eval.js.description":
    "允许 eval 工具把 JavaScript 单元格派发给进程内运行时",
  "settings.field.eval.autoProvision.label": "Eval 环境自动准备",
  "settings.field.eval.autoProvision.description":
    "首次安装时自动创建受管理的 JavaScript eval 包环境",
  "settings.field.eval.tools.enabled.label": "Eval 定义的工具",
  "settings.field.eval.tools.enabled.description":
    "允许 eval 单元格定义工具（Python 中的 @tool、JS 中的 tool(fn)），供 task、agent() 与 workpool() 子 Agent 调用",
  "settings.field.eval.workpool.freshAgents.label": "Workpool 全新 Agent",
  "settings.field.eval.workpool.freshAgents.description":
    "为每个 workpool 项新建子 Agent，而不是复用 worker 或批量处理排队项",
  "settings.field.eval.autoBackground.enabled.label": "Eval 自动转后台",
  "settings.field.eval.autoBackground.enabled.description":
    "自动将长时间运行的 eval 单元格转入后台，稍后投递结果",
  "settings.field.python.kernelMode.label": "Python 内核模式",
  "settings.field.python.kernelMode.description":
    "在多次 eval 调用之间保持 IPython 内核存活，还是每次都重新启动",
  "settings.field.python.interpreter.label": "Python 解释器",
  "settings.field.python.interpreter.description":
    "可选，指定确切的 Python 可执行文件路径。设置后将跳过 Python 运行时的自动发现",

  "settings.group.context.general": "常规",
  "settings.group.context.compaction": "上下文压缩",
  "settings.group.context.rules-ttsr": "TTSR 规则",
  "settings.group.context.experimental": "实验性",

  "settings.field.contextPromotion.enabled.label": "自动提升上下文",
  "settings.field.contextPromotion.enabled.description":
    "上下文溢出时改用更大上下文的模型，而不是压缩",
  "settings.field.extendedContext.label": "扩展上下文",
  "settings.field.extendedContext.description":
    "在支持的情况下使用更大的上下文窗口；可能产生更高计费。关闭则保持默认或标准计费的窗口",
  "settings.field.compaction.enabled.label": "自动压缩",
  "settings.field.compaction.enabled.description": "上下文过大时自动压缩",
  "settings.field.compaction.experimentalContextManagement.label":
    "笔记支撑的上下文窗口（实验性）",
  "settings.field.compaction.experimentalContextManagement.description":
    "在不同的上下文窗口之间保留持久笔记和可搜索的原始历史。",
  "settings.field.compaction.midTurnEnabled.label": "轮次中压缩",
  "settings.field.compaction.midTurnEnabled.description":
    "在下一个 Provider 请求之前，于安全的轮次中工具循环边界检查阈值；子 Agent 始终检查，因为它们的整个任务就是一轮",
  "settings.field.compaction.methodOrder.label": "压缩方法顺序",
  "settings.field.compaction.methodOrder.description":
    "自动上下文维护的首选回退顺序；不可用或执行失败的方法会推进到下一个选项",
  "settings.field.compaction.thresholdPercent.label": "压缩阈值",
  "settings.field.compaction.thresholdPercent.description":
    "上下文维护的百分比阈值；设为 Default 则使用旧的按预留量计算的行为",
  "settings.field.compaction.thresholdTokens.label": "压缩 Token 上限",
  "settings.field.compaction.thresholdTokens.description":
    "上下文维护的固定 Token 上限；设置后覆盖百分比阈值",
  "settings.field.compaction.handoffSaveToDisk.label": "保存交接文档",
  "settings.field.compaction.handoffSaveToDisk.description":
    "将生成的交接文档保存为 markdown 文件，供自动交接流程使用",
  "settings.field.compaction.remoteStreamingV2Enabled.label": "远程压缩 V2",
  "settings.field.compaction.remoteStreamingV2Enabled.description":
    "对兼容的远程压缩模型使用 Responses 流式压缩",
  "settings.field.compaction.asyncEnabled.label": "异步压缩",
  "settings.field.compaction.asyncEnabled.description":
    "上下文接近压缩阈值时在后台预先摘要，越过阈值时再把已就绪的结果拼接进来",
  "settings.field.compaction.idleEnabled.label": "空闲压缩",
  "settings.field.compaction.idleEnabled.description":
    "空闲且 Token 数超过阈值时压缩上下文",
  "settings.field.compaction.idleThresholdTokens.label": "空闲压缩阈值",
  "settings.field.compaction.idleThresholdTokens.description":
    "超过该 Token 数即触发空闲压缩",
  "settings.field.compaction.idleTimeoutSeconds.label": "空闲压缩延迟",
  "settings.field.compaction.idleTimeoutSeconds.description": "空闲后等待多少秒再压缩",
  "settings.field.compaction.supersedeReads.label": "替换过期读取",
  "settings.field.compaction.supersedeReads.description":
    "同一文件被再次读取时修剪较早的读取结果（缓存感知，每轮执行）",
  "settings.field.compaction.dropUseless.label": "省略无结果输出",
  "settings.field.compaction.dropUseless.description":
    "工具结果被判定为上下文无用（无匹配、等待超时）且已被消费后将其修剪掉（缓存感知）",
  "settings.field.snapcompact.systemPrompt.label": "Snapcompact 系统提示词",
  "settings.field.snapcompact.systemPrompt.description":
    "实验性：把选定的系统提示词文本渲染为高密度 PNG 图片并附加到首条用户消息（仅视觉模型）。可节省 Token；但被转成图片的文本会失去提示词缓存。",
  "settings.field.snapcompact.toolResults.label": "Snapcompact 工具结果",
  "settings.field.snapcompact.toolResults.description":
    "实验性：把较大的工具结果（含最新的一条）渲染为高密度 PNG 图片而非文本（仅视觉模型）。可在累积的搜索与命令输出上节省 Token；除非已知该模型能精确依据图片编辑，读取结果仍保留为文本。",
  "settings.field.tools.format.label": "工具调用模式",
  "settings.field.tools.format.description":
    "控制工具如何暴露给模型。Auto 使用 Provider 原生工具调用，若所选模型被标记为不支持，则回退到 GLM 自有方言。Native 强制使用 Provider 原生工具；其他值强制使用指定的自有方言。",
  "settings.field.snapcompact.shape.label": "Snapcompact 形状",
  "settings.field.snapcompact.shape.description":
    "snapcompact 打印文本时使用的框形（压缩归档与内联成像）。Auto 会选择适合当前模型的形状。",
  "settings.field.branchSummary.enabled.label": "分支摘要",
  "settings.field.branchSummary.enabled.description": "离开分支时提示生成摘要",
  "settings.field.ttsr.enabled.label": "TTSR",
  "settings.field.ttsr.enabled.description":
    "输出匹配规则模式时在流式过程中打断 Agent（Time-Traveling Stream Rules）",
  "settings.field.ttsr.judge.label": "判定式规则",
  "settings.field.ttsr.judge.description":
    "让 judge 模型角色针对已完成的回复、推理与工具调用逐条询问 `question` 规则；回答为 yes 时以警告形式注入该规则",
  "settings.field.ttsr.contextMode.label": "TTSR 上下文模式",
  "settings.field.ttsr.contextMode.description": "TTSR 触发时如何处理已产生的部分输出",
  "settings.field.ttsr.interruptMode.label": "TTSR 打断模式",
  "settings.field.ttsr.interruptMode.description":
    "何时在流式过程中打断，何时在完成后注入警告",
  "settings.field.ttsr.repeatMode.label": "TTSR 重复模式",
  "settings.field.ttsr.repeatMode.description":
    "规则如何重复触发：每个会话一次，或在消息间隔后再次触发",
  "settings.field.ttsr.repeatGap.label": "TTSR 重复间隔",
  "settings.field.ttsr.repeatGap.description": "规则再次触发前需经过的消息数",
  "settings.field.ttsr.builtinRules.label": "内置规则",
  "settings.field.ttsr.builtinRules.description":
    "加载 Agent 自带的默认规则（可用 ttsr.disabledRules 逐条覆盖）",

  "settings.group.memory.general": "常规",
  "settings.group.memory.auto-learn": "自动学习",
  "settings.group.memory.mnemopi": "Mnemopi",
  "settings.group.memory.hindsight": "Hindsight",
  "settings.group.memory.sharpshooter": "Sharpshooter",

  "settings.field.memory.backend.label": "记忆后端",
  "settings.field.memory.backend.description":
    "关闭、本地摘要流水线、Mnemopi SQLite、Hindsight 远程记忆，或 Sharpshooter",
  "settings.field.sharpshooter.model.label": "Sharpshooter 模型",
  "settings.field.sharpshooter.model.description":
    "用于抽取/整合的模型选择器，留空表示 smol 角色",
  "settings.field.autolearn.enabled.label": "自动学习（实验性）",
  "settings.field.autolearn.enabled.description":
    "Agent 停止后提示它将经验教训写入记忆，并创建或增强隔离的托管技能",
  "settings.field.autolearn.autoContinue.label": "停止时自动执行捕获",
  "settings.field.autolearn.autoContinue.description":
    "开启时，停止时自动执行一轮私有捕获（会消耗额外 Token）。关闭时只保留常驻的自动学习指引。",
  "settings.field.mnemopi.dbPath.label": "Mnemopi DB 路径",
  "settings.field.mnemopi.dbPath.description":
    "可选，SQLite DB 路径。默认为 Agent 记忆目录。",
  "settings.field.mnemopi.bank.label": "Mnemopi Bank",
  "settings.field.mnemopi.bank.description":
    "可选，共享 bank 的基础名称。按项目模式会据此派生项目本地的 bank。",
  "settings.field.mnemopi.scoping.label": "Mnemopi 作用域",
  "settings.field.mnemopi.scoping.description":
    "global = 一个共享 bank；per-project = 每个 CWD 独立的 bank；per-project-tagged = 项目本地写入并具备全局召回可见性",
  "settings.field.mnemopi.embeddingVariant.label": "Embedding 变体",
  "settings.field.mnemopi.embeddingVariant.description":
    "本地 embedding 模型系列。en = 更强的英文模型；multilingual = 跨语言模型。更改后会在下次启动时重建已有的记忆 embedding。",
  "settings.field.mnemopi.autoRecall.label": "Mnemopi 自动召回",
  "settings.field.mnemopi.autoRecall.description":
    "在每个会话的首轮召回本地记忆",
  "settings.field.mnemopi.autoRetain.label": "Mnemopi 自动保留",
  "settings.field.mnemopi.autoRetain.description":
    "将已完成的对话轮次保留到本地 Mnemopi 记忆",
  "settings.field.mnemopi.polyphonicRecall.label": "Mnemopi 复调召回",
  "settings.field.mnemopi.polyphonicRecall.description":
    "将召回与图、事实、向量和时间多种声部融合，使关联记忆无需关键词匹配也能浮现",
  "settings.field.mnemopi.enhancedRecall.label": "Mnemopi 增强召回",
  "settings.field.mnemopi.enhancedRecall.description":
    "以相同选项缓存重复与相似查询的召回结果；任何记忆写入都会清除该缓存",
  "settings.field.mnemopi.proactiveLinking.label": "Mnemopi 主动关联",
  "settings.field.mnemopi.proactiveLinking.description":
    "新记忆入库时即写入情节图，并与相关实体和记忆建立关联",
  "settings.field.mnemopi.noEmbeddings.label": "Mnemopi 禁用 Embedding",
  "settings.field.mnemopi.noEmbeddings.description":
    "强制使用确定性的仅 FTS 召回，而不使用向量 embedding",
  "settings.field.mnemopi.embeddingModel.label": "Mnemopi Embedding 模型",
  "settings.field.mnemopi.embeddingModel.description":
    "高级：显式的 embedding 模型 id，会覆盖变体设置。留空则使用 mnemopi.embeddingVariant。",
  "settings.field.mnemopi.embeddingApiUrl.label": "Mnemopi Embedding API URL",
  "settings.field.mnemopi.embeddingApiUrl.description":
    "可选，传给 Mnemopi 的 OpenAI 兼容 embedding 端点",
  "settings.field.mnemopi.embeddingApiKey.label": "Mnemopi Embedding API Key",
  "settings.field.mnemopi.embeddingApiKey.description":
    "可选，传给 Mnemopi 的 embedding API Key",
  "settings.field.mnemopi.llmMode.label": "Mnemopi LLM 模式",
  "settings.field.mnemopi.llmMode.description":
    "不使用 LLM、使用在线小模型（/models 中的 TINY 角色，否则为 @smol），或使用远程 OpenAI 兼容端点",
  "settings.field.mnemopi.llmBaseUrl.label": "Mnemopi LLM Base URL",
  "settings.field.mnemopi.llmBaseUrl.description":
    "可选，Mnemopi 远程模式使用的 OpenAI 兼容 LLM 端点",
  "settings.field.mnemopi.llmApiKey.label": "Mnemopi LLM API Key",
  "settings.field.mnemopi.llmApiKey.description":
    "可选，Mnemopi 远程模式使用的 LLM API Key",
  "settings.field.mnemopi.llmModel.label": "Mnemopi LLM 模型",
  "settings.field.mnemopi.llmModel.description":
    "可选，Mnemopi 远程模式使用的 LLM 模型名称",
  "settings.field.hindsight.apiUrl.label": "Hindsight API URL",
  "settings.field.hindsight.apiUrl.description": "Hindsight 服务器 URL（Cloud 或自托管）",
  "settings.field.hindsight.apiToken.label": "Hindsight API Token",
  "settings.field.hindsight.apiToken.description":
    "用于需要认证的 Hindsight 服务器的 Bearer Token",
  "settings.field.hindsight.bankId.label": "Hindsight Bank ID",
  "settings.field.hindsight.bankId.description": "记忆 bank 标识（默认：项目名）",
  "settings.field.hindsight.scoping.label": "Hindsight 作用域",
  "settings.field.hindsight.scoping.description":
    "global = 一个共享 bank；per-project = 每个 CWD 独立的 bank；per-project-tagged = 带项目标签的共享 bank，召回时全局与项目记忆合并",
  "settings.field.hindsight.autoRecall.label": "Hindsight 自动召回",
  "settings.field.hindsight.autoRecall.description": "在每个会话的首轮召回记忆",
  "settings.field.hindsight.autoRetain.label": "Hindsight 自动保留",
  "settings.field.hindsight.autoRetain.description":
    "每 N 轮以及会话边界保留对话记录",
  "settings.field.hindsight.retainMode.label": "Hindsight 保留模式",
  "settings.field.hindsight.retainMode.description":
    "full-session = 每个会话 upsert 一个文档；last-turn = 分块",
  "settings.field.hindsight.mentalModelsEnabled.label": "Hindsight 心智模型",
  "settings.field.hindsight.mentalModelsEnabled.description":
    "启动时将经过整理的 reflect 摘要（心智模型）读入开发者指令。只加载 bank 上已有的模型，不会写入。配合 hindsight.mentalModelAutoSeed 可同时自动创建内置种子集。",
  "settings.field.hindsight.mentalModelAutoSeed.label": "Hindsight 心智模型自动播种",
  "settings.field.hindsight.mentalModelAutoSeed.description":
    "会话开始时，在 bank 上创建尚不存在的内置心智模型（project-conventions、project-decisions、user-preferences）。",
};
