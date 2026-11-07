/** omp 设置面板 tools 与 files 标签的简体中文文案。 */
export const toolsFiles: Record<string, string> = {
  "settings.group.tools.available-tools": "可用工具",
  "settings.group.tools.todos": "待办",
  "settings.group.tools.grep-browser": "Grep 与浏览器",
  "settings.group.tools.computer": "计算机",
  "settings.group.tools.ida-pro": "IDA Pro",
  "settings.group.tools.github": "GitHub",
  "settings.group.tools.output-limits": "输出限制",
  "settings.group.tools.execution": "执行",
  "settings.group.tools.discovery-mcp": "发现与 MCP",
  "settings.group.tools.extensions": "扩展",
  "settings.group.tools.developer": "开发者",
  "settings.group.files.editing": "编辑",
  "settings.group.files.reading": "读取",
  "settings.group.files.read-summaries": "读取摘要",
  "settings.group.files.lsp": "LSP",

  "settings.field.todo.enabled.label": "待办",
  "settings.field.todo.enabled.description": "启用 todo 工具以跟踪任务",
  "settings.field.glob.enabled.label": "Glob",
  "settings.field.glob.enabled.description": "启用 glob 工具，按 glob 查找文件",
  "settings.field.grep.enabled.label": "Grep",
  "settings.field.grep.enabled.description": "启用 grep 工具，按正则搜索内容",
  "settings.field.astGrep.enabled.label": "AST Grep",
  "settings.field.astGrep.enabled.description": "启用 ast_grep 工具，进行结构化 AST 搜索",
  "settings.field.astEdit.enabled.label": "AST Edit",
  "settings.field.astEdit.enabled.description": "启用 ast_edit 工具，进行结构化 AST 改写",
  "settings.field.find.enabled.label": "Find（语义 grep）",
  "settings.field.find.enabled.description":
    "启用 find 工具：用自然语言搜索文件与行范围，由 judge 模型角色判定。仅在 judge 角色解析为原生 TypeSafe jev 模型时自动启用",
  "settings.field.debug.enabled.label": "调试",
  "settings.field.debug.enabled.description": "启用 debug 工具，基于 DAP 进行调试",
  "settings.field.launch.enabled.label": "服务",
  "settings.field.launch.enabled.description": "启用具名 bash 服务与 proc:// 托管，用于共享的长期运行项目进程",
  "settings.field.speechgen.enabled.label": "语音生成",
  "settings.field.speechgen.enabled.description": "启用 tts 工具，进行设备端（Kokoro）或 xAI Grok Voice 语音文件合成",
  "settings.field.generate_image.enabled.label": "生成图片",
  "settings.field.generate_image.enabled.description":
    "启用 generate_image 工具（文生图与图片编辑）。打开 tools.xdev 后以 xd:// 设备形式提供。",
  "settings.field.computer.enabled.label": "计算机",
  "settings.field.computer.enabled.description": "启用可脚本化的宿主桌面 eval 前奏（截图、输入、无障碍）",
  "settings.field.ratchet.enabled.label": "Ratchet",
  "settings.field.ratchet.enabled.description": "启用 ratchet eval/hillclimb 前奏；/ratchet 会为当前会话开启",
  "settings.field.archive.enabled.label": "归档",
  "settings.field.archive.enabled.description": "启用只读 archive eval 前奏：提示历史、最近项目、过往会话与摘要",
  "settings.field.checkpoint.enabled.label": "检查点/回退",
  "settings.field.checkpoint.enabled.description": "启用 checkpoint 与 rewind 工具，用于上下文检查点",
  "settings.field.fetch.enabled.label": "读取 URL",
  "settings.field.fetch.enabled.description": "允许 read 工具抓取并处理 URL",
  "settings.field.vault.enabled.label": "Obsidian Vault",
  "settings.field.vault.enabled.description":
    "启用 vault:// 内部 URL，通过 Obsidian CLI 读取与编辑 Obsidian 库内容。禁用后拒绝解析 vault://，系统提示中也不再包含 vault:// 条目。",
  "settings.field.github.enabled.label": "GitHub CLI",
  "settings.field.github.enabled.description":
    "启用 github 工具（基于 op 的分发，覆盖仓库、issue、pull request、diff、搜索、checkout、push 与 Actions watch 工作流）",
  "settings.field.web_search.enabled.label": "联网搜索",
  "settings.field.web_search.enabled.description": "启用 web_search 工具以获取实时网页结果",
  "settings.field.security.enabled.label": "安全",
  "settings.field.security.enabled.description":
    "启用 OMP 原生的安全扫描规划与执行，以及只读的 security:// 资源命名空间",
  "settings.field.ask.enabled.label": "询问",
  "settings.field.ask.enabled.description": "启用 ask 工具，向用户发起交互式提问",
  "settings.field.browser.enabled.label": "浏览器",
  "settings.field.browser.enabled.description": "启用 browser eval 前奏，进行脚本化 Chromium 自动化（Puppeteer）",
  "settings.field.ida.enabled.label": "IDA Pro",
  "settings.field.ida.enabled.description":
    "把通过 `read` 打开的可执行文件在 IDA Pro（idalib）中打开，并启用 `ida` 工具；未找到 IDA 安装时不生效",

  "settings.field.todo.reminders.label": "待办提醒",
  "settings.field.todo.reminders.description": "在停止前提醒 Agent 完成待办",
  "settings.field.todo.remindersMax.label": "待办提醒上限",
  "settings.field.todo.remindersMax.description": "放弃前最多发出的待办提醒次数",
  "settings.field.todo.eager.label": "自动创建待办",
  "settings.field.todo.eager.description": "首条消息之后推动自动创建待办列表的强度",
  "settings.field.tasks.todoClearDelay.label": "待办自动清除延迟",
  "settings.field.tasks.todoClearDelay.description": "已完成或已放弃的待办从待办组件中移除前的延迟",

  "settings.field.grep.contextBefore.label": "Grep 前文行数",
  "settings.field.grep.contextBefore.description": "每个 grep 匹配项之前的上下文行数",
  "settings.field.grep.contextAfter.label": "Grep 后文行数",
  "settings.field.grep.contextAfter.description": "每个 grep 匹配项之后的上下文行数",
  "settings.field.browser.cdpUrl.label": "浏览器 CDP URL",
  "settings.field.browser.cdpUrl.description":
    "默认的 HTTP CDP 发现端点（例如 http://127.0.0.1:9222），用于连接而不是启动新浏览器。工具调用中显式指定的 app.cdp_url 或 app.path 优先。",
  "settings.field.browser.relay.label": "浏览器中继",
  "settings.field.browser.relay.description":
    "通过 omp 浏览器中继驱动你自己的 Chrome 标签页。先安装一次扩展（`omp browser-relay install`）；browser 前奏需要时中继服务会自动启动。优先于浏览器 CDP URL；可设置 PI_BROWSER_RELAY=0 或 PI_BROWSER_RELAY=1 覆盖。",
  "settings.field.browser.relayUrl.label": "浏览器中继 URL",
  "settings.field.browser.relayUrl.description": "omp 浏览器中继端点（默认 http://127.0.0.1:9224）。",
  "settings.field.browser.headless.label": "无头浏览器",
  "settings.field.browser.headless.description": "以无头模式启动浏览器（禁用则显示浏览器界面）",
  "settings.field.browser.cmux.label": "cmux 浏览器",
  "settings.field.browser.cmux.description":
    "cmux socket 可用时，使用 cmux WKWebView 界面进行浏览器自动化。可设置 PI_BROWSER_CMUX=0 或 PI_BROWSER_CMUX=1 覆盖。",
  "settings.field.browser.tern.label": "Tern 浏览器",
  "settings.field.browser.tern.description":
    "在 Tern 面板内，把浏览器标签页以画中画形式开在 omp 面板之上（原生网页视图），而不是使用无头 Chromium；没有能承载它们的 Tern 窗口时回退到 Chromium。显式的 app 选项、中继与浏览器 CDP URL 优先；app.tern:false 可让单次打开不进入该模式。可设置 PI_BROWSER_TERN=0 或 PI_BROWSER_TERN=1 覆盖。",
  "settings.field.browser.freezeOnTurnEnd.label": "回合结束时冻结浏览器标签页",
  "settings.field.browser.freezeOnTurnEnd.description":
    "一轮结束时冻结 OMP 拥有的无头浏览器标签页，使动画页面在空闲时不再消耗 CPU/GPU。标签页会在下次使用时自动解冻；打开时传入 persist:true 可让某个标签页不被冻结。",
  "settings.field.browser.idleCloseSec.label": "浏览器空闲关闭超时",
  "settings.field.browser.idleCloseSec.description":
    "关闭空闲超过该秒数的 OMP 拥有的无头浏览器标签页与 Tern 浏览器画中画（0 表示从不关闭；会话销毁时仍会回收）。不会影响中继/CDP/外部启动的浏览器，也不会影响其他会话的标签页。",
  "settings.field.browser.screenshotDir.label": "截图目录",
  "settings.field.browser.screenshotDir.description":
    "保存截图的目录。未设置时截图写入临时文件。支持 ~。示例：~/Downloads、~/Desktop、/sdcard/Download（Android）",

  "settings.field.computer.display.label": "计算机显示器",
  "settings.field.computer.display.description": "活动窗口所在的显示器（active）、所有显示器（all），或原生显示器 id",

  "settings.field.ida.python.label": "IDA Python",
  "settings.field.ida.python.description": "可导入 ida_domain 与 idapro 的 Python 解释器；留空则自动检测",
  "settings.field.ida.installDir.label": "IDA 安装目录",
  "settings.field.ida.installDir.description":
    "包含 libidalib 的目录，导出为 IDADIR；留空则自动检测（$IDADIR、ida-config.json、标准安装路径）",
  "settings.field.ida.maxOpen.label": "IDA 最大打开数据库数",
  "settings.field.ida.maxOpen.description":
    "每个项目同时打开的 IDA 数据库上限（omp ps 中的 omp.ida.* 守护进程）；再打开一个时会保存并关闭最久未使用的空闲数据库",
  "settings.field.ida.idleCloseSec.label": "IDA 空闲关闭超时",
  "settings.field.ida.idleCloseSec.description":
    "保存并关闭空闲超过该秒数的 IDA 数据库（0 表示从不关闭）；重新打开时 exec 命名空间会重置",

  "settings.field.github.cache.enabled.label": "GitHub 视图缓存",
  "settings.field.github.cache.enabled.description":
    "把渲染后的 issue/PR 视图输出缓存在 ~/.omp/cache/github-cache.db，使重复读取无需额外开销",

  "settings.field.tools.artifactSpillThreshold.label": "产物溢出阈值（KB）",
  "settings.field.tools.artifactSpillThreshold.description": "工具输出超过此大小时保存为产物文件；尾部内容仍内联保留",
  "settings.field.tools.artifactTailBytes.label": "产物尾部大小（KB）",
  "settings.field.tools.artifactTailBytes.description": "输出溢出到产物文件时，内联保留的尾部内容大小",
  "settings.field.tools.artifactHeadBytes.label": "产物头部大小（KB）",
  "settings.field.tools.artifactHeadBytes.description":
    "输出溢出到产物文件时，与尾部一同内联保留的头部内容大小（中间省略）。设为 0 即禁用，只保留尾部。",
  "settings.field.tools.outputMaxColumns.label": "输出列宽上限",
  "settings.field.tools.outputMaxColumns.description":
    "流式工具输出（bash、python、js eval）与 `read` 的单行字节上限。超过该宽度的行以省略号截断，到下一个换行符之前的剩余字节会被丢弃。0 表示禁用。",
  "settings.field.tools.artifactTailLines.label": "产物尾部行数",
  "settings.field.tools.artifactTailLines.description": "输出溢出到产物文件时，内联保留的尾部内容最大行数",
  "settings.field.tools.artifactMaxBytes.label": "产物文件上限（MB）",
  "settings.field.tools.artifactMaxBytes.description":
    "流式工具输出（bash、python、js eval）所保存产物文件的大小上限。更大的输出保留开头部分（最多 3 MB）与最近的剩余部分，两者之间带有截断提示。0 表示不限制。",

  "settings.field.images.questionTimeoutMs.label": "图片问答超时",
  "settings.field.images.questionTimeoutMs.description":
    "read 的 ?q= 图片问答背后视觉模型调用的单次请求超时，单位为毫秒。Provider 卡住时会以超时错误快速失败，而不是阻塞到手动中止。设为 0 可禁用超时。",
  "settings.field.tools.intentTracing.label": "意图追踪",
  "settings.field.tools.intentTracing.description": "要求 Agent 在执行每个工具调用前说明其意图",
  "settings.field.tools.abortOnFabricatedResult.label": "中止伪造的工具结果",
  "settings.field.tools.abortOnFabricatedResult.description":
    "对于带内工具调用，当模型在回合中途开始臆造工具结果时立即停止。禁用后改为让模型生成完毕，再丢弃伪造的后续内容。",
  "settings.field.tools.speculativeExecution.enabled.label": "实验性推测执行",
  "settings.field.tools.speculativeExecution.enabled.description":
    "启用可安全丢弃的第一部分：通过直接 read 调用与嵌套 eval 执行的、经过校验的本地读取。网络请求、Provider 补全与实时文件系统写入不在这一范围内。",
  "settings.field.tools.speculativeExecution.maxInFlight.label": "推测执行并发数",
  "settings.field.tools.speculativeExecution.maxInFlight.description":
    "正常调度前允许并行运行的、经过校验的本地读取数量上限。",
  "settings.field.tools.maxTimeout.label": "工具最大超时",
  "settings.field.tools.maxTimeout.description": "Agent 可为任意工具设置的最大超时秒数（0 表示不限制）",
  "settings.field.async.enabled.label": "异步执行",
  "settings.field.async.enabled.description": "启用异步 bash 命令与后台任务执行",

  "settings.field.tools.xdev.label": "xd:// 工具",
  "settings.field.tools.xdev.description":
    "把不常用（可发现）的工具挂载到 xd:// 设备 URL 下，通过 read/write 驱动，而不是在每次请求中都发送它们的 schema。显式工具列表授予 read 但缺少 write 的会话，会通过仅设备可写的传输挂载设备（除设备外只有 local:// 暂存区可写）。禁用后所有已启用的工具都以顶层工具暴露。",
  "settings.field.tools.xdevDocs.label": "xd:// 提示文档",
  "settings.field.tools.xdevDocs.description":
    "选择哪些挂载设备的文档与 schema 内联到系统提示中。Built-ins 会内联核心工具，而 MCP 与扩展工具保持按需加载。",
  "settings.field.mcp.enableProjectConfig.label": "MCP 项目配置",
  "settings.field.mcp.enableProjectConfig.description": "从项目根目录加载 .mcp.json/mcp.json",
  "settings.field.mcp.renderMarkdownResults.label": "MCP Markdown 结果",
  "settings.field.mcp.renderMarkdownResults.description": "在记录中将非 JSON 的 MCP 文本结果渲染为 Markdown",
  "settings.field.mcp.notifications.label": "MCP 更新注入",
  "settings.field.mcp.notifications.description": "把 MCP 资源更新注入 Agent 对话",

  "settings.field.dev.autoqa.label": "Auto QA",
  "settings.field.dev.autoqa.description":
    "自动上报工具问题（xd://report_issue）。默认开启；首次上报会征得同意，拒绝后将禁用上报，直到显式重新启用",
  "settings.field.dev.autoqaPush.endpoint.label": "Auto QA 推送端点",
  "settings.field.dev.autoqaPush.endpoint.description":
    "接收 Auto QA JSON 报告的完整 URL（默认 https://qa.omp.sh/v1/grievances）",

  "settings.field.edit.mode.label": "编辑模式",
  "settings.field.edit.mode.description": "选择 edit 工具的变体（replace、patch、hashline 或 apply_patch）",
  "settings.field.edit.fuzzyMatch.label": "模糊匹配",
  "settings.field.edit.fuzzyMatch.description": "接受针对空白 Diff 的高置信度模糊匹配",
  "settings.field.edit.fuzzyThreshold.label": "模糊匹配阈值",
  "settings.field.edit.fuzzyThreshold.description": "接受模糊匹配的相似度阈值（0-1）",
  "settings.field.edit.streamingAbort.label": "预览失败时中止",
  "settings.field.edit.streamingAbort.description": "补丁预览失败时中止流式 edit 工具调用",
  "settings.field.edit.recoverInlineEdits.label": "恢复内联编辑内容",
  "settings.field.edit.recoverInlineEdits.description": "把模型以纯文本形式输出的编辑内容转换为 edit 工具调用并执行",
  "settings.field.edit.blockAutoGenerated.label": "阻止自动生成的文件",
  "settings.field.edit.blockAutoGenerated.description": "禁止编辑看起来是自动生成的文件（protoc、sqlc、swagger 等）",
  "settings.field.edit.enforceSeenLines.label": "强制已见行校验",
  "settings.field.edit.enforceSeenLines.description": "拒绝锚定在此前 read/search 从未完整显示过的行上的编辑",
  "settings.field.edit.blackbox.enabled.label": "记录解析回归",
  "settings.field.edit.blackbox.enabled.description": "当编辑导致 AST 解析失败时，追加完整的修改前后源码",
  "settings.field.edit.autoRepair.enabled.label": "自动修复解析回归",
  "settings.field.edit.autoRepair.enabled.description":
    "当编辑破坏文件的 AST 解析时，请求 smol 模型修复损坏区域（通过重新解析校验；失败则回退为警告）",

  "settings.field.readLineNumbers.label": "行号",
  "settings.field.readLineNumbers.description": "默认在 read 工具输出前添加行号",
  "settings.field.read.defaultLimit.label": "默认读取行数",
  "settings.field.read.defaultLimit.description": "Agent 调用 read 未指定 limit 时默认返回的行数",
  "settings.field.read.renderMarkdown.label": "Markdown 预览",
  "settings.field.read.renderMarkdown.description": "把 Markdown 的 read 结果渲染为终端 Markdown 预览，而不是原始源码",
  "settings.field.read.toolResultPreview.label": "内联读取预览",
  "settings.field.read.toolResultPreview.description": "在记录中内联渲染 read 工具结果，而不是摘要行",

  "settings.field.read.summarize.enabled.label": "读取摘要",
  "settings.field.read.summarize.enabled.description": "未指定显式选择器调用 read 时返回结构化代码摘要",
  "settings.field.read.summarize.prose.label": "文本摘要",
  "settings.field.read.summarize.prose.description": "对 Markdown 与纯文本的读取返回结构化摘要",

  "settings.field.lsp.enabled.label": "LSP",
  "settings.field.lsp.enabled.description": "启用 lsp 工具以提供代码智能（定义、引用、诊断、重命名）",
  "settings.field.lsp.lazy.label": "LSP 延迟启动",
  "settings.field.lsp.lazy.description":
    "在首次使用时（调用 lsp 工具或编辑匹配的文件类型）启动语言服务器，而不是在会话启动时",
  "settings.field.lsp.shared.label": "共享语言服务器",
  "settings.field.lsp.shared.description":
    "通过守护进程代理，在多个 omp 实例之间为每个项目共享一个语言服务器（不可用时回退为私有服务器）",
  "settings.field.lsp.formatOnWrite.label": "写入时格式化",
  "settings.field.lsp.formatOnWrite.description": "写入后使用 LSP 自动格式化代码文件",
  "settings.field.lsp.diagnosticsOnWrite.label": "写入时诊断",
  "settings.field.lsp.diagnosticsOnWrite.description": "写入代码文件后返回 LSP 诊断",
  "settings.field.lsp.diagnosticsOnEdit.label": "编辑时诊断",
  "settings.field.lsp.diagnosticsOnEdit.description": "编辑代码文件后返回 LSP 诊断",
  "settings.field.lsp.diagnosticsDeduplicate.label": "诊断去重",
  "settings.field.lsp.diagnosticsDeduplicate.description":
    "抑制已为该文件显示过的编辑后 LSP 诊断，只呈现新增或变化的诊断",
};
