/** omp 设置面板 appearance 标签的英文文案。 */
export const appearance: Record<string, string> = {
  "settings.group.appearance.theme": "Theme",
  "settings.group.appearance.composer": "Composer",
  "settings.group.appearance.status-line": "Status Line",
  "settings.group.appearance.display": "Display",
  "settings.group.appearance.images": "Images",

  "settings.field.theme.dark.label": "Dark Theme",
  "settings.field.theme.dark.description": "Theme used when the terminal has a dark background",
  "settings.field.theme.light.label": "Light Theme",
  "settings.field.theme.light.description": "Theme used when the terminal has a light background",
  "settings.field.symbolPreset.label": "Symbol Preset",
  "settings.field.symbolPreset.description": "Glyph set for icons and symbols (Unicode, Nerd Font, or ASCII)",
  "settings.field.colorBlindMode.label": "Color-Blind Mode",
  "settings.field.colorBlindMode.description": "Use blue instead of green for diff additions",

  "settings.field.composer.shape.label": "Composer Shape",
  "settings.field.composer.shape.description": "Visual layout of the input editor and status line",
  "settings.field.composer.tokenRate.label": "Generation Rate",
  "settings.field.composer.tokenRate.description":
    "Show a live generation tok/s readout: on the working row next to the session title, or in the native composer bar right after the thinking level, where the last reading stays between turns. Estimated from streamed deltas and corrected by the provider's billed output count as each message completes.",

  "settings.field.statusLine.preset.label": "Status Line Preset",
  "settings.field.statusLine.preset.description": "Pre-built status line configurations",
  "settings.field.statusLine.separator.label": "Status Line Separator",
  "settings.field.statusLine.separator.description": "Style of separators between segments",
  "settings.field.statusLine.contextLine.label": "Context-Reactive Line",
  "settings.field.statusLine.contextLine.description":
    "How the line between the left and right segments reflects context usage (box composer only)",
  "settings.field.statusLine.sessionAccent.label": "Session Accent",
  "settings.field.statusLine.sessionAccent.description":
    "Use the session name color for the editor border and status line gap",
  "settings.field.statusLine.transparent.label": "Transparent Status Line",
  "settings.field.statusLine.transparent.description":
    "Use the terminal's default background for the status line instead of the theme's `statusLineBg`. Powerline end caps are dropped because they need a contrasting fill to bridge into the surrounding terminal.",
  "settings.field.statusLine.compactThinkingLevel.label": "Compact Thinking Level",
  "settings.field.statusLine.compactThinkingLevel.description":
    "Show the thinking level as a single icon on the model name instead of a separate ` · <level>` suffix; in Tern's composer, as the model chip's icon instead of a separate chip (click the icon to cycle it).",
  "settings.field.statusLine.showHookStatus.label": "Show Hook Status",
  "settings.field.statusLine.showHookStatus.description": "Display hook status messages below the status line",

  "settings.field.terminal.showImages.label": "Show Inline Images",
  "settings.field.terminal.showImages.description": "Render images inline in the terminal",
  "settings.field.images.autoResize.label": "Auto-Resize Images",
  "settings.field.images.autoResize.description": "Resize large images to 2000x2000 max for better model compatibility",
  "settings.field.images.blockImages.label": "Block Images",
  "settings.field.images.blockImages.description": "Prevent images from being sent to LLM providers",

  "settings.field.tui.resizeScrollback.label": "Resize Scrollback",
  "settings.field.tui.resizeScrollback.description":
    "How a settled terminal resize refreshes transcript rows retained in terminal scrollback",
  "settings.field.terminal.showProgress.label": "Native Terminal Progress",
  "settings.field.terminal.showProgress.description":
    "Emit OSC 9;4 indeterminate progress while the agent or context maintenance is running (always on in Tern)",
  "settings.field.terminal.programStatus.label": "Program Status (OSC 7501)",
  "settings.field.terminal.programStatus.description":
    "Report whether the agent is working, waiting on you, done, or failed over OSC 7501, for terminal tab indicators and agent inboxes",
  "settings.field.tui.textSizing.label": "Large Headings (Kitty)",
  "settings.field.tui.textSizing.description":
    "Render Markdown H1 headings at 2x scale using Kitty's OSC 66 text-sizing protocol. Only takes effect on Kitty terminals; ignored everywhere else. Off by default.",
  "settings.field.tui.renderMermaid.label": "Render Mermaid Diagrams",
  "settings.field.tui.renderMermaid.description": "Render Mermaid fenced code blocks as ASCII diagrams",
  "settings.field.tui.renderSvg.label": "Render SVG Figures",
  "settings.field.tui.renderSvg.description":
    "Invite the agent to draw diagrams and charts as SVG, rendered inline as images on terminals that show graphics",
  "settings.field.tui.autoGraph.label": "Auto-Graph Tables",
  "settings.field.tui.autoGraph.description":
    "Draw a chart under numeric tables in the agent's answers, in your theme's colors, on terminals that show graphics",
  "settings.field.tui.reactions.label": "Agent Reactions",
  "settings.field.tui.reactions.description":
    "Invite the agent to react to your message with an emoji badge on its bubble",
  "settings.field.tui.codexResetFireworks.label": "Codex Reset Fireworks",
  "settings.field.tui.codexResetFireworks.description":
    "Celebrate unscheduled Codex weekly usage resets and newly banked saved resets with a top-third fireworks overlay that remains until Esc",
  "settings.field.tui.titleState.label": "Terminal Title Run State",
  "settings.field.tui.titleState.description":
    "Show the agent run state in the terminal title's separator — an animated spinner while working (a static ':' under WSL), '>' when it's your turn, '!' when the agent is waiting on you",
  "settings.field.tui.titleSpinner.label": "Terminal Title Spinner",
  "settings.field.tui.titleSpinner.description":
    "Glyph set for the working-state spinner in the terminal title — braille sweep, filling moon, single-dot cycle, or ASCII-safe line",
  "settings.field.tui.hyperlinks.label": "Terminal Hyperlinks",
  "settings.field.tui.hyperlinks.description":
    "Wrap paths and URLs in OSC 8 hyperlinks for terminal-native click-to-open (auto: detect support; off: never; always: unconditional)",
  "settings.field.tui.mouse.label": "Mouse Click-to-Focus",
  "settings.field.tui.mouse.description":
    "Capture mouse clicks in the main session so live subagent cards and HUD rows focus on click, with a hover highlight on the target. Native text selection becomes Shift+drag and wheel scroll becomes Shift+wheel while on",
  "settings.field.tui.tight.label": "Tight Layout",
  "settings.field.tui.tight.description":
    "Remove the 1-character horizontal padding from the left and right of the terminal output",
  "settings.field.display.shimmer.label": "Shimmer",
  "settings.field.display.shimmer.description": "Animation style for working/loading messages",
  "settings.field.display.pinnedAgents.label": "Pinned Agents",
  "settings.field.display.pinnedAgents.description":
    "Pinned live-agent jump list above the editor (off hides it; collapsed shows a few rows with an expander; full lists all)",
  "settings.field.display.subagentLivePreview.label": "Subagent Live Preview",
  "settings.field.display.subagentLivePreview.description":
    "Show each pinned subagent's current (or most recent) tool call beneath its row",
  "settings.field.display.smoothStreaming.label": "Smooth Streaming",
  "settings.field.display.smoothStreaming.description":
    "Reveal assistant text and streamed tool input smoothly while chunks arrive",
  "settings.field.display.hideToolActivity.label": "Hide Tool Activity",
  "settings.field.display.hideToolActivity.description":
    "Hide model-initiated tool calls and results from the transcript",
  "settings.field.display.showTokenUsage.label": "Show Token Usage",
  "settings.field.display.showTokenUsage.description": "Show per-turn token usage on assistant messages",
  "settings.field.display.showTurnTime.label": "Show Turn Time",
  "settings.field.display.showTurnTime.description":
    "Show the total prompt-to-yield time (including tool calls) on assistant message usage rows",
  "settings.field.display.cacheMissMarker.label": "Cache Miss Marker",
  "settings.field.display.cacheMissMarker.description":
    "Show a divider after an assistant turn whose request lost (missed) the prompt cache",
  "settings.field.display.collapseCompacted.label": "Collapse Compacted History",
  "settings.field.display.collapseCompacted.description":
    "Collapse pre-compaction history behind the summary divider on the live transcript; disable to keep the full transcript inline with dividers at each compaction point",
  "settings.field.showHardwareCursor.label": "Show Hardware Cursor",
  "settings.field.showHardwareCursor.description": "Show terminal cursor for IME support",
  "settings.field.tui.imeSafeCursor.label": "IME-Safe Prompt Layout",
  "settings.field.tui.imeSafeCursor.description":
    "Move the prompt's bottom border to a separate row so macOS IME preedit cannot displace it",
  "settings.field.task.showResolvedModelBadge.label": "Show Resolved Model Badge",
  "settings.field.task.showResolvedModelBadge.description":
    "Display the actual model ID used by each subagent in the task widget status line",
  "settings.field.title.icons.label": "Title Icons",
  "settings.field.title.icons.description": "Icon and short code that head new generated or /rename session titles",
};
