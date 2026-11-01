/** omp 设置面板 appearance 标签的简体中文文案。 */
export const appearance: Record<string, string> = {
  "settings.group.appearance.theme": "主题",
  "settings.group.appearance.composer": "输入框",
  "settings.group.appearance.status-line": "状态行",
  "settings.group.appearance.display": "显示",
  "settings.group.appearance.images": "图片",

  "settings.field.theme.dark.label": "深色主题",
  "settings.field.theme.dark.description": "终端使用深色背景时应用的主题",
  "settings.field.theme.light.label": "浅色主题",
  "settings.field.theme.light.description": "终端使用浅色背景时应用的主题",
  "settings.field.symbolPreset.label": "符号集",
  "settings.field.symbolPreset.description": "图标与符号使用的字形集（Unicode、Nerd Font 或 ASCII）",
  "settings.field.colorBlindMode.label": "色盲模式",
  "settings.field.colorBlindMode.description": "差异的新增部分使用蓝色代替绿色",

  "settings.field.composer.shape.label": "输入框形状",
  "settings.field.composer.shape.description": "输入编辑器与状态行的视觉布局",
  "settings.field.composer.tokenRate.label": "生成速率",
  "settings.field.composer.tokenRate.description":
    "实时显示生成速度（tok/s）：工作行中会话标题旁，或原生输入条里思考级别之后；最后一次读数保留到下一轮。数值由流式增量估算，并在每条消息完成时按服务商计费的输出数校正。",

  "settings.field.statusLine.preset.label": "状态行预设",
  "settings.field.statusLine.preset.description": "预置的状态行配置",
  "settings.field.statusLine.separator.label": "状态行分隔符",
  "settings.field.statusLine.separator.description": "各片段之间分隔符的样式",
  "settings.field.statusLine.contextLine.label": "上下文响应线",
  "settings.field.statusLine.contextLine.description":
    "左右片段之间的线段如何反映上下文用量（仅盒式输入框）",
  "settings.field.statusLine.sessionAccent.label": "会话强调色",
  "settings.field.statusLine.sessionAccent.description":
    "编辑器边框与状态行间隙使用会话名称的颜色",
  "settings.field.statusLine.transparent.label": "透明状态行",
  "settings.field.statusLine.transparent.description":
    "状态行使用终端默认背景，不再使用主题的 `statusLineBg`。Powerline 端帽会被去掉，因为它们需要对比填充才能与周围终端衔接。",
  "settings.field.statusLine.compactThinkingLevel.label": "紧凑思考级别",
  "settings.field.statusLine.compactThinkingLevel.description":
    "在模型名上以单个图标显示思考级别，不再使用独立的 ` · <level>` 后缀；在 Tern 输入框中显示为模型标签的图标，点击图标可循环切换。",
  "settings.field.statusLine.showHookStatus.label": "显示钩子状态",
  "settings.field.statusLine.showHookStatus.description": "在状态行下方显示钩子状态消息",

  "settings.field.terminal.showImages.label": "显示内联图片",
  "settings.field.terminal.showImages.description": "在终端中内联渲染图片",
  "settings.field.images.autoResize.label": "自动调整图片尺寸",
  "settings.field.images.autoResize.description": "把大图缩放到最大 2000x2000，以提升模型兼容性",
  "settings.field.images.blockImages.label": "阻止图片",
  "settings.field.images.blockImages.description": "禁止把图片发送给 LLM 服务商",

  "settings.field.tui.resizeScrollback.label": "调整回滚缓冲",
  "settings.field.tui.resizeScrollback.description":
    "终端尺寸稳定后，如何刷新保留在终端回滚缓冲中的记录行",
  "settings.field.terminal.showProgress.label": "原生终端进度",
  "settings.field.terminal.showProgress.description":
    "智能体或上下文维护运行时，通过 OSC 9;4 发出不确定进度（Tern 中始终开启）",
  "settings.field.terminal.programStatus.label": "程序状态（OSC 7501）",
  "settings.field.terminal.programStatus.description":
    "通过 OSC 7501 报告智能体正在工作、等待你、已完成或失败，供终端标签指示器与智能体收件箱使用",
  "settings.field.tui.textSizing.label": "大标题（Kitty）",
  "settings.field.tui.textSizing.description":
    "使用 Kitty 的 OSC 66 文字缩放协议把 Markdown 一级标题渲染为 2 倍大小。仅在 Kitty 终端生效，其它终端忽略。默认关闭。",
  "settings.field.tui.renderMermaid.label": "渲染 Mermaid 图",
  "settings.field.tui.renderMermaid.description": "把 Mermaid 围栏代码块渲染为字符画",
  "settings.field.tui.renderSvg.label": "渲染 SVG 图形",
  "settings.field.tui.renderSvg.description":
    "邀请智能体用 SVG 绘制图表，在支持图形的终端中内联显示为图片",
  "settings.field.tui.autoGraph.label": "表格自动绘图",
  "settings.field.tui.autoGraph.description":
    "在智能体回答里的数值表格下方绘制图表，使用主题配色；仅在支持图形的终端生效",
  "settings.field.tui.reactions.label": "智能体表情回应",
  "settings.field.tui.reactions.description":
    "允许智能体用表情徽标回应你的消息，徽标显示在其气泡上",
  "settings.field.tui.codexResetFireworks.label": "Codex 重置烟花",
  "settings.field.tui.codexResetFireworks.description":
    "Codex 每周用量意外重置或新存入重置次数时，在画面上三分之一处播放烟花，直到按 Esc 才消失",
  "settings.field.tui.titleState.label": "终端标题运行状态",
  "settings.field.tui.titleState.description":
    "在终端标题的分隔符中显示智能体运行状态：工作时为动画旋转符（WSL 下为静态 ':'），轮到你时为 '>'，等待你回应时为 '!'",
  "settings.field.tui.titleSpinner.label": "终端标题旋转符",
  "settings.field.tui.titleSpinner.description":
    "终端标题中工作状态旋转符使用的字形集：盲文扫描、填充月相、单点循环或 ASCII 安全线段",
  "settings.field.tui.hyperlinks.label": "终端超链接",
  "settings.field.tui.hyperlinks.description":
    "用 OSC 8 超链接包裹路径与网址，支持在终端中点击打开（auto：自动检测支持；off：从不；always：始终）",
  "settings.field.tui.mouse.label": "鼠标点击聚焦",
  "settings.field.tui.mouse.description":
    "在主会话中捕获鼠标点击，点击即可聚焦实时子智能体卡片与 HUD 行，目标悬停时高亮。开启后原生文本选择改为 Shift+拖拽，滚轮滚动改为 Shift+滚轮",
  "settings.field.tui.tight.label": "紧凑布局",
  "settings.field.tui.tight.description": "去掉终端输出左右各 1 个字符的水平留白",
  "settings.field.display.shimmer.label": "微光",
  "settings.field.display.shimmer.description": "工作与加载消息的动画样式",
  "settings.field.display.pinnedAgents.label": "置顶智能体",
  "settings.field.display.pinnedAgents.description":
    "编辑框上方的实时智能体跳转列表（off 隐藏；collapsed 只显示几行并带展开器；full 显示全部）",
  "settings.field.display.subagentLivePreview.label": "子智能体实时预览",
  "settings.field.display.subagentLivePreview.description":
    "在每个置顶子智能体的行下方显示当前或最近一次工具调用",
  "settings.field.display.smoothStreaming.label": "平滑流式输出",
  "settings.field.display.smoothStreaming.description":
    "内容分块到达时平滑显示助手文本与流式工具输入",
  "settings.field.display.hideToolActivity.label": "隐藏工具活动",
  "settings.field.display.hideToolActivity.description": "在记录中隐藏模型发起的工具调用与结果",
  "settings.field.display.showTokenUsage.label": "显示 Token 用量",
  "settings.field.display.showTokenUsage.description": "在助手消息上显示每轮 Token 用量",
  "settings.field.display.showTurnTime.label": "显示轮次耗时",
  "settings.field.display.showTurnTime.description":
    "在助手消息的用量行显示从提示到让出的总耗时（含工具调用）",
  "settings.field.display.cacheMissMarker.label": "缓存未命中标记",
  "settings.field.display.cacheMissMarker.description":
    "助手轮次的请求未命中提示缓存时，在该轮之后显示分隔线",
  "settings.field.display.collapseCompacted.label": "折叠已压缩历史",
  "settings.field.display.collapseCompacted.description":
    "在实时记录中把压缩前的历史折叠到摘要分隔线之后；关闭后完整记录内联显示，每个压缩点保留分隔线",
  "settings.field.showHardwareCursor.label": "显示硬件光标",
  "settings.field.showHardwareCursor.description": "显示终端光标以支持输入法",
  "settings.field.tui.imeSafeCursor.label": "输入法安全布局",
  "settings.field.tui.imeSafeCursor.description":
    "把提示框下边框移到单独一行，避免 macOS 输入法预编辑内容顶开边框",
  "settings.field.task.showResolvedModelBadge.label": "显示实际模型徽标",
  "settings.field.task.showResolvedModelBadge.description":
    "在任务组件状态行显示每个子智能体实际使用的模型 ID",
  "settings.field.title.icons.label": "标题图标",
  "settings.field.title.icons.description":
    "新增的生成标题或 /rename 标题前使用的图标与短代码",
};
