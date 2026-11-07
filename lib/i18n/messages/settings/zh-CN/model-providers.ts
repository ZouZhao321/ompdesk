/** omp 设置面板 model 与 providers 标签的简体中文文案。 */
export const modelProviders: Record<string, string> = {
	"settings.group.model.thinking": "思考",
	"settings.group.model.sampling": "采样",
	"settings.group.model.prompt": "提示词",
	"settings.group.model.retry-fallback": "重试与回退",
	"settings.group.model.advisor": "顾问",
	"settings.group.model.prewalk": "Prewalk",
	"settings.group.model.vision": "视觉",

	"settings.field.defaultThinkingLevel.label": "思考级别",
	"settings.field.defaultThinkingLevel.description": "支持思考的模型的推理深度",
	"settings.field.hideThinkingBlock.label": "隐藏思考块",
	"settings.field.hideThinkingBlock.description": "在助手回复中隐藏思考块",
	"settings.field.expandThinkingBlocks.label": "展开思考块",
	"settings.field.expandThinkingBlocks.description": "回合结束时保持已完成的思考块展开，而不是折叠起来",
	"settings.field.proseOnlyThinking.label": "思考仅保留正文",
	"settings.field.proseOnlyThinking.description": "从思考摘要中省略代码块，并用省略号代替",
	"settings.field.omitThinking.label": "省略思考摘要",
	"settings.field.omitThinking.description": "指示上游 Provider 在响应中完全省略思考摘要（若支持）",
	"settings.field.externalThinking.label": "外部思考",
	"settings.field.externalThinking.description": "私有草稿区，不向用户显示。会禁用受支持的 GPT、Claude 和 Gemini 推理",
	"settings.field.model.loopGuard.enabled.label": "循环防护",
	"settings.field.model.loopGuard.enabled.description": "为模型推理和正文启用自动流循环检测",
	"settings.field.model.loopGuard.checkAssistantContent.label": "循环防护扫描正文",
	"settings.field.model.loopGuard.checkAssistantContent.description": "除思考日志外，也对助手的正文消息应用循环防护",
	"settings.field.model.loopGuard.toolCallReminder.label": "循环防护工具调用提醒",
	"settings.field.model.loopGuard.toolCallReminder.description":
		"当 Gemini 推理流连续输出多个规划标题却未调用工具时，中断它并注入要求发起工具调用的提醒（需启用循环防护）",
	"settings.field.model.toolCallLoopGuard.enabled.label": "工具调用循环防护",
	"settings.field.model.toolCallLoopGuard.enabled.description": "检测跨回合连续重复的工具调用，并注入纠正性引导",
	"settings.field.providers.autoThinkingMaxEffort.label": "Auto 思考上限",
	"settings.field.providers.autoThinkingMaxEffort.description":
		"`auto` 分类器可解析的最高力度。`xhigh` 让分类器始终低于最高档，因此只有显式的 `ultrathink` 才会达到 `max`；`max` 则允许分类器判定为例外的回合在支持最高档的模型上使用最高档。",

	"settings.field.temperature.label": "温度",
	"settings.field.temperature.description": "采样温度（0 = 确定性，1 = 有创造性，-1 = Provider 默认值）",
	"settings.field.topP.label": "Top P",
	"settings.field.topP.description": "核采样截断阈值（0-1，-1 = Provider 默认值）",
	"settings.field.topK.label": "Top K",
	"settings.field.topK.description": "从概率最高的 K 个 Token 中采样（-1 = Provider 默认值）",
	"settings.field.minP.label": "Min P",
	"settings.field.minP.description": "最小概率阈值（0-1，-1 = Provider 默认值）",
	"settings.field.presencePenalty.label": "存在惩罚",
	"settings.field.presencePenalty.description": "对引入已出现 Token 的惩罚（-1 = Provider 默认值）",
	"settings.field.repetitionPenalty.label": "重复惩罚",
	"settings.field.repetitionPenalty.description": "对重复 Token 的惩罚（-1 = Provider 默认值）",
	"settings.field.textVerbosity.label": "文本详细度",
	"settings.field.textVerbosity.description": "OpenAI Responses 与 Codex 响应的详细度（low、medium 或 high）",
	"settings.field.tier.openai.label": "服务层级 — OpenAI",
	"settings.field.tier.openai.description":
		"OpenAI / OpenAI-Codex 请求，以及经 OpenRouter 路由的 OpenAI 系列模型的处理层级（none = 省略）。以 `service_tier` 发送。",
	"settings.field.tier.anthropic.label": "服务层级 — Anthropic",
	"settings.field.tier.anthropic.description":
		'Claude 请求的处理层级。在受支持的直接 Anthropic 模型上，`priority` 会启用快速模式（`speed: "fast"`）；对 Bedrock/Vertex 上的 Claude 以及经 OpenRouter 的请求无效。',
	"settings.field.tier.google.label": "服务层级 — Google",
	"settings.field.tier.google.description":
		"Gemini（Google AI Studio + Vertex）请求，以及经 OpenRouter 路由的 Google 系列模型的处理层级（none = 省略）。作为顶层 `serviceTier` 字段发送。",
	"settings.field.tier.subagent.label": "服务层级 — 子 Agent",
	"settings.field.tier.subagent.description":
		"派生的 task/eval 子 Agent 使用的服务层级。Inherit = 跟随主 Agent 实时的各系列层级（会跟踪 /fast）；选择某个值则将其应用到子 Agent 模型所属的系列。",
	"settings.field.tier.advisor.label": "服务层级 — 顾问",
	"settings.field.tier.advisor.description":
		"顾问模型使用的服务层级。None = 标准处理；Inherit = 跟随主 Agent 实时的各系列层级；选择某个值则将其应用到顾问模型所属的系列。",

	"settings.field.modelRoleStorage.label": "模型角色存储",
	"settings.field.modelRoleStorage.description": "模型选择器角色分配结果的保存位置",
	"settings.field.inlineToolDescriptors.label": "内联工具描述",
	"settings.field.inlineToolDescriptors.description":
		"在系统提示词中渲染完整的工具描述，并从 Provider 的工具 schema 中移除顶层与嵌套描述，使描述文本只发送一次。Auto 会为 Gemini 模型启用，其余情况禁用",
	"settings.field.includeModelInPrompt.label": "在提示词中包含模型",
	"settings.field.includeModelInPrompt.description":
		"在系统提示词中显示当前模型标识，让 Agent 知道自己使用的是哪个模型",
	"settings.field.includeWorkspaceTree.label": "包含工作区目录树",
	"settings.field.includeWorkspaceTree.description":
		"在系统提示词中渲染工作区目录树。警告：文件被修改时，这可能跨会话破坏提示词缓存。",
	"settings.field.skillful.label": "在提示词中列出技能",
	"settings.field.skillful.description": "在系统提示词中列出可用技能；禁用可节省上下文，也可按会话通过 /skillful 切换",
	"settings.field.personality.label": "个性",
	"settings.field.personality.description": "渲染到系统提示词个性块中的沟通风格",

	"settings.field.retry.maxRetries.label": "重试次数",
	"settings.field.retry.maxRetries.description": "API 错误时的最大重试次数",
	"settings.field.retry.waitForUsageReset.label": "等待用量重置",
	"settings.field.retry.waitForUsageReset.description":
		"当 Provider 报告用量限额耗尽并给出重置时间（任意 Provider 的 5 小时或每周配额窗口）时，休眠到重置时，而不是在超过 retry.maxDelayMs 后快速失败。等待可中止（Esc），但也会阻塞子 Agent，因此无人值守运行时建议关闭。",
	"settings.field.retry.modelFallback.label": "重试模型回退",
	"settings.field.retry.modelFallback.description": "允许重试恢复时切换到已配置的回退模型",
	"settings.field.retry.fallbackOn.label": "回退触发条件",
	"settings.field.retry.fallbackOn.description": "哪些失败请求可以切换到已配置的回退模型",
	"settings.field.retry.usageAwareFallback.label": "用量感知回退",
	"settings.field.retry.usageAwareFallback.description":
		"利用可靠的 coding-plan 配额报告，在触及硬性用量限额前优先选择同一 Provider 的账户，然后是已配置的回退模型。普通配置的 API Key 不在此列。",
	"settings.field.retry.usageReservePct.label": "预留余量",
	"settings.field.retry.usageReservePct.description":
		"剩余百分比低于该值时，将 coding-plan 模型视为接近限额。用量未知或未映射时保留主模型。",
	"settings.field.retry.usageReservePolicy.label": "预留策略",
	"settings.field.retry.usageReservePolicy.description":
		"当同一 Provider 的所有 coding-plan 账户都落在预留余量内时如何处理。",
	"settings.field.retry.fallbackChains.label": "重试回退链",
	"settings.field.retry.fallbackChains.description":
		'JSON 对象，将模型角色、模型选择器（"provider/model-id"）或 Provider 通配符（"provider/*"）映射为有序的回退选择器，例如 {"default":["openai/gpt-4o-mini"],"google-antigravity/*":["google/*","google-vertex/*"]}。面向模型的键在该模型/Provider 处于活动状态时生效，与角色无关；"provider/*" 条目保留失败模型的 id 并替换 Provider。带 id 前缀的通配符（"openrouter/google/*"）会为失败模型的裸 id 重新加前缀（google-antigravity/gemini-x -> openrouter/google/gemini-x），作为键使用时只匹配该 Provider 前缀下的 id。回退条目可携带显式的思考后缀（"provider/model:low"、":high"、":max"、":off"）；裸条目继承失败回合的力度，"provider/*" 条目始终继承。',
	"settings.field.retry.fallbackRevertPolicy.label": "回退恢复策略",
	"settings.field.retry.fallbackRevertPolicy.description": "回退之后何时返回主模型",
	"settings.field.providers.anthropic.serverSideFallback.label": "Anthropic 服务端回退（Fable 5）",
	"settings.field.providers.anthropic.serverSideFallback.description":
		"当 Claude Fable 5 / Mythos 5 请求被 Anthropic 的安全分类器拦截时，在服务端改用 Claude Opus 5 重试（Anthropic `server-side-fallback-2026-06-01` beta）。需主动启用——保持关闭会为所有请求保留回退之前的行为。",

	"settings.field.advisor.enabled.label": "启用顾问",
	"settings.field.advisor.enabled.description":
		"配对第二个模型（分配给 'advisor' 角色），被动审查每个回合并注入提示。",
	"settings.field.advisor.syncBacklog.label": "顾问积压同步",
	"settings.field.advisor.syncBacklog.description":
		"暂停主 Agent，直到顾问积压低于阈值。数值表示最多等待 30 秒；strict 会等待所有已排期的审查，没有实际时间上限。Off 关闭追赶延迟。中止、失败和释放都会解除等待。",
	"settings.field.advisor.immuneTurns.label": "顾问免疫回合",
	"settings.field.advisor.immuneTurns.description":
		"在顾问的关注点或阻塞点打断后，接下来这么多主回合内，把进一步的关注点作为不打断的旁注发送。阻塞点不受冷却限制。",
	"settings.field.advisor.reviewMode.label": "顾问审查模式",
	"settings.field.advisor.reviewMode.description":
		"未提供 WATCHDOG.yml 名单时的默认顾问节奏。turn 审查每个主回合；agent-end 仅审查最终交付。",
	"settings.field.advisor.reviewInterval.label": "顾问审查间隔",
	"settings.field.advisor.reviewInterval.description":
		"未提供 WATCHDOG.yml 名单时的默认顾问节奏：每第 N 次符合条件的主更新审查一次。1 = 每次更新。被跳过的更新随下一次计划审查一起发送。",
	"settings.field.advisor.maxNotesPerUpdate.label": "顾问单次更新最多提示数",
	"settings.field.advisor.maxNotesPerUpdate.description":
		"每次顾问提示词更新接受的非阻塞建议提示上限（1–32；UI 提供 1–5 个快捷选项）。阻塞点不受限制。",
	"settings.field.advisor.evictStaleResults.label": "顾问清除过期结果",
	"settings.field.advisor.evictStaleResults.description":
		"每次审查前，将顾问在更早审查中的 read/grep/glob 输出替换为简短占位符，最新一次审查的结果保留。",

	"settings.field.prewalk.enabled.label": "启用 Prewalk",
	"settings.field.prewalk.enabled.description":
		"先使用当前模型，在计划提示的待办清单生成后第一次编辑/写入时切换到快速、廉价的模型（默认为 'smol' 角色）——由强模型完成规划、提交待办并开始实现，然后再交接。可按会话通过 --prewalk / --no-prewalk 覆盖。",

	"settings.field.images.describeForTextModels.label": "为文本模型描述图片",
	"settings.field.images.describeForTextModels.description":
		"当图片附加到不支持视觉的模型时，将其保存到 local:// 下并注入由具备视觉能力的模型生成的描述，而不是丢弃该图片",
	"settings.field.images.urls.enabled.label": "以 URL 提供图片",
	"settings.field.images.urls.enabled.description":
		"通过已配置的后端链发布外发图片，并向支持 URL 拉取的 Provider 发送短 URL，而不是内联 base64。所有后端或某个 Provider 拉取失败时自动回退为内联",
	"settings.field.images.urls.backends.label": "图片 URL 后端",
	"settings.field.images.urls.backends.description": "为 Provider 访问发布图片时依次尝试的目标",
	"settings.field.images.urls.command.label": "图片上传命令",
	"settings.field.images.urls.command.description":
		"command 后端的 Argv 模板；{file} 是图片路径，{mime}/{ext} 可选。使用 stdout 上打印的最后一个 URL（例如 pasta -b -f {file}）",
	"settings.field.images.urls.publicBaseUrl.label": "图片 URL 公网基础地址",
	"settings.field.images.urls.publicBaseUrl.description":
		"位于 blob 服务器之前、可从外部访问的基础 URL（ssh 必填，direct 可选）",
	"settings.field.images.urls.bindHost.label": "图片 URL 绑定主机",
	"settings.field.images.urls.bindHost.description":
		"blob 服务器绑定的主机；隧道使用 loopback，直接提供服务使用 0.0.0.0",
	"settings.field.images.urls.sshTarget.label": "图片 URL SSH 目标",
	"settings.field.images.urls.sshTarget.description": "ssh 反向转发的 user@host 目标",

	"settings.group.providers.services": "服务",
	"settings.group.providers.fireworks": "Fireworks",
	"settings.group.providers.tiny-model": "小型模型",
	"settings.group.providers.protocol": "协议",
	"settings.group.providers.timeouts": "超时",
	"settings.group.providers.privacy": "隐私",

	"settings.field.providers.maxInFlightRequests.label": "最大并发请求数",
	"settings.field.providers.maxInFlightRequests.description":
		'每个 Provider id 的最大并发 LLM 请求数（例如 "openai" 或 "anthropic"），在使用同一配置根目录的本地 OMP 进程间共享。未列出的 Provider 不限。',
	"settings.field.providers.webSearchTimeoutSeconds.label": "网页搜索超时",
	"settings.field.providers.webSearchTimeoutSeconds.description":
		"每个 Provider 搜索传输的硬超时（秒），超时后 web_search 会转向下一个回退项（最大 300）",
	"settings.field.providers.antigravityEndpoint.label": "Antigravity 端点模式",
	"settings.field.providers.antigravityEndpoint.description":
		"google-antigravity Provider 的端点路由策略（chat、search、image、discovery）",
	"settings.field.live.voice.label": "实时语音",
	"settings.field.live.voice.description": "由 Codex 支持的实时语音会话使用的声音",
	"settings.field.tts.localVoice.label": "本地 TTS 语音",
	"settings.field.tts.localVoice.description": "本地 TTS 后端使用的 Kokoro 声音（美式/英式，女声/男声）",
	"settings.field.tts.localSpeed.label": "本地 TTS 语速",
	"settings.field.tts.localSpeed.description": "本地 TTS 后端的语速（tts 工具、omp say）。1 = 正常；限制在 0.5–2.5",
	"settings.field.speech.enabled.label": "语音朗读",
	"settings.field.speech.enabled.description": "在助手输出流式生成时通过扬声器朗读",
	"settings.field.speech.mode.label": "语音朗读模式",
	"settings.field.speech.mode.description":
		"朗读内容：all = 助手消息 + 思考；assistant = 仅消息；yield = 仅回合结束时的最终消息",
	"settings.field.speech.enhanced.label": "增强语音改写",
	"settings.field.speech.enhanced.description":
		"合成前先用 tiny/smol 模型把助手输出改写为自然口语（描述代码，去掉链接和 markdown）。失败时回退为机械清理",
	"settings.field.speech.voice.label": "语音朗读声音",
	"settings.field.speech.voice.description": "朗读助手输出时使用的 Kokoro 声音",
	"settings.field.speech.speed.label": "语音朗读语速",
	"settings.field.speech.speed.description": "朗读助手输出时的语速。1 = 正常；限制在 0.5–2.5",
	"settings.field.providers.fetch.label": "抓取 Provider",
	"settings.field.providers.fetch.description": "fetch/read URL 工具的读取器后端优先级",
	"settings.field.codexResets.autoRedeem.label": "Codex 自动兑换已保存的重置",
	"settings.field.codexResets.autoRedeem.description":
		"自动使用已保存的 Codex 速率限制重置：当某个回合卡住且没有其他账户可以接手时，恢复因 5 小时或每周窗口耗尽而被阻塞的账户，并抢救即将过期的额度。unset 会在首次使用前询问（没有提示 UI 时，只使用 5 分钟内到期的重置），yes 不经询问直接使用，no 关闭这两项检查。",
	"settings.field.claudeResets.autoRedeem.label": "Claude 自动兑换重置",
	"settings.field.claudeResets.autoRedeem.description":
		"自动使用符合条件的 Claude Cedar 或 Juniper 重置。Cedar 仅用于覆盖范围内的限额；Juniper 只能恢复唯一的 5 小时阻塞。unset 会在首次使用前询问（没有提示 UI 时，只使用 5 分钟内到期的重置），yes 不经询问直接使用，no 关闭阻塞恢复与过期抢救。",
	"settings.field.exa.enabled.label": "Exa",
	"settings.field.exa.enabled.description": "启用 Exa 网页搜索 Provider",
	"settings.field.searxng.endpoint.label": "SearXNG 端点",
	"settings.field.searxng.endpoint.description": "用于网页搜索的自建 SearXNG 实例的基础 URL",

	"settings.field.providers.fireworksTier.label": "Fireworks 层级",
	"settings.field.providers.fireworksTier.description":
		'Fireworks 请求的服务路径。Priority 会发送 `service_tier: "priority"`，在高峰流量时以更高价格换取更高可靠性；Standard 不发送。Fast（`-fast`）模型忽略此项——Fast 本身即为独立的服务路径。',

	"settings.field.providers.tinyModelDevice.label": "小型模型设备",
	"settings.field.providers.tinyModelDevice.description":
		"本地小型模型（标题 + memory）的推理后端：ONNX 执行 Provider，或 `mlx` 以在 Apple silicon 上通过 mlx-lm 下载并运行 MLX 权重。默认使用仅 CPU 的 ONNX。环境变量 PI_TINY_DEVICE 会覆盖此设置。",
	"settings.field.providers.tinyModelDtype.label": "小型模型精度",
	"settings.field.providers.tinyModelDtype.description":
		"本地小型模型的 ONNX 量化/精度。默认使用各模型自带的 dtype（q4）；精度越低速度越快，越高越忠实。MLX 后端忽略此项（其仓库已预量化为 4-bit）。环境变量 PI_TINY_DTYPE 会覆盖此设置。",

	"settings.field.providers.kimiApiFormat.label": "Kimi API 格式",
	"settings.field.providers.kimiApiFormat.description": "Kimi Code Provider 的 API 格式（auto 跟随实时模型元数据）",
	"settings.field.providers.openaiWebsockets.label": "OpenAI WebSockets",
	"settings.field.providers.openaiWebsockets.description":
		"OpenAI Codex 模型的 WebSocket 策略（auto 使用模型默认值，on 强制启用，off 禁用）",
	"settings.field.providers.openaiLiveSteering.label": "OpenAI 实时引导",
	"settings.field.providers.openaiLiveSteering.description":
		"在 GPT-6 响应流式输出期间输入的消息会经 Codex WebSocket 送入该响应，而不是等到下一个工具边界",
	"settings.field.providers.muse-code.storeResponses.label": "Muse Code 存储响应",
	"settings.field.providers.muse-code.storeResponses.description":
		"将 Muse Code 结果存储在 Meta 的服务器上，使连接中断的回合可以被恢复而不是重跑。存储的运行会在 Meta 侧保留提示词和输出。",
	"settings.field.providers.cacheRetention.label": "提示词缓存保留",
	"settings.field.providers.cacheRetention.description":
		"转发给支持该功能的 Provider（Anthropic、Bedrock、OpenRouter、OpenAI）的提示词缓存保留设置",
	"settings.field.providers.cacheWarming.label": "缓存预热",
	"settings.field.providers.cacheWarming.description":
		"在提示词缓存条目过期前不久，用单 Token 输出预算重新发送上一次请求",
	"settings.field.providers.openrouterVariant.label": "OpenRouter 路由",
	"settings.field.providers.openrouterVariant.description":
		"追加到 OpenRouter 模型 ID 的默认路由变体后缀（选择器已指定变体时被覆盖）",
	"settings.field.provider.appendOnlyContext.label": "仅追加上下文",
	"settings.field.provider.appendOnlyContext.description":
		"缓存系统提示词 + 工具规格，并维护仅追加的消息日志，使 Provider 前缀缓存（DeepSeek、Xiaomi/SGLang、Anthropic）命中率最大化。Auto 会为已知的前缀缓存 Provider 启用。",

	"settings.field.providers.streamFirstEventTimeoutSeconds.label": "流首事件超时",
	"settings.field.providers.streamFirstEventTimeoutSeconds.description":
		"等待模型流第一个事件的秒数；-1 使用 Provider/环境默认值，0 禁用看门狗",
	"settings.field.providers.streamIdleTimeoutSeconds.label": "流空闲超时",
	"settings.field.providers.streamIdleTimeoutSeconds.description":
		"模型流在事件之间允许静默的秒数；-1 使用 Provider/环境默认值，0 禁用看门狗",

	"settings.field.telemetry.otlpExportEnabled.label": "OTLP 遥测导出",
	"settings.field.telemetry.otlpExportEnabled.description":
		"允许 OMP 使用 OTEL_* 端点导出 trace、日志和指标。更改在下次启动时生效。",
	"settings.field.secrets.enabled.label": "隐藏密钥",
	"settings.field.secrets.enabled.description": "混淆已配置的密钥，并在发送给 AI Provider 前遮盖凭据形式的 Token",
};
