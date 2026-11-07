/** omp 设置面板 interaction 与 tasks 标签的英文文案。 */
export const interactionTasks: Record<string, string> = {
  "settings.group.interaction.input": "Input",
  "settings.group.interaction.approvals": "Approvals",
  "settings.group.interaction.notifications": "Notifications",
  "settings.group.interaction.speech": "Speech",
  "settings.group.interaction.collab": "Collab",
  "settings.group.interaction.stream": "Stream",
  "settings.group.interaction.magic-keywords": "Magic Keywords",
  "settings.group.interaction.startup-updates": "Startup & Updates",
  "settings.group.interaction.power": "Power",
  "settings.group.interaction.agent": "Agent",
  "settings.group.interaction.git": "Git",
  "settings.group.interaction.skills": "Skills",
  "settings.group.tasks.modes": "Modes",
  "settings.group.tasks.subagents": "Subagents",
  "settings.group.tasks.isolation": "Isolation",
  "settings.group.tasks.commands-skills": "Commands & Skills",

  "settings.field.steeringMode.label": "Steering Mode",
  "settings.field.steeringMode.description":
    "How to process queued messages while agent is working",
  "settings.field.followUpMode.label": "Follow-Up Mode",
  "settings.field.followUpMode.description":
    "How to drain follow-up messages after a turn completes",
  "settings.field.interruptMode.label": "Interrupt Mode",
  "settings.field.interruptMode.description": "When steering messages interrupt tool execution",
  "settings.field.tui.vimMode.label": "Vim Editing Mode",
  "settings.field.tui.vimMode.description":
    "Modal prompt editing. Esc leaves Insert mode; Normal mode has hjkl, 0, $, ^, w, b, e, gg, G, counts, x/D/C, dd/yy, p and u; operators take motions or text objects (diw, ca(, dap); v/V start a Visual selection that y copies and d deletes",
  "settings.field.tui.vimModeDisplay.label": "Vim Mode Indicator",
  "settings.field.tui.vimModeDisplay.description":
    "How the current Vim mode appears in the status line",
  "settings.field.loop.mode.label": "Loop Mode",
  "settings.field.loop.mode.description":
    "What happens between /loop iterations before re-submitting the prompt",
  "settings.field.loop.conditionTimeoutMs.label": "Loop Condition Timeout (ms)",
  "settings.field.loop.conditionTimeoutMs.description":
    "Max wait for a `/loop --while` / `--until` condition command before treating it as broken and stopping the loop. Set to 0 to wait indefinitely",
  "settings.field.composer.recallClearedDrafts.label": "Recall Cleared Drafts",
  "settings.field.composer.recallClearedDrafts.description":
    "Keep drafts cleared with Ctrl+C in local Up/Down history until exit; disabling affects future clears",
  "settings.field.doubleEscapeAction.label": "Double-Escape Action",
  "settings.field.doubleEscapeAction.description":
    "What pressing Esc twice with an empty editor does: open the transcript rewind selector, open the session tree, or nothing",
  "settings.field.input.bareExitOnEmptySession.label": "Bare Exit on Empty Session",
  "settings.field.input.bareExitOnEmptySession.description":
    "Submitting exactly `exit`, `quit`, or `q` (any case) before the first message quits instead of prompting the model",
  "settings.field.input.bareSlashCommands.label": "Bare Slash Commands",
  "settings.field.input.bareSlashCommands.description":
    "Submitting exactly a command name without the leading `/` (e.g. `model`, `compact`) runs that slash command; once the session has messages, press Enter twice to confirm",
  "settings.field.treeFilterMode.label": "Session Tree Filter",
  "settings.field.treeFilterMode.description": "Default filter mode when opening the session tree",
  "settings.field.autocompleteMaxVisible.label": "Autocomplete Items",
  "settings.field.autocompleteMaxVisible.description":
    "Max visible items in autocomplete dropdown (3-20)",
  "settings.field.spelling.typoDetection.label": "Typo Detection (macOS)",
  "settings.field.spelling.typoDetection.description":
    "Mark misspelled prompt words with the active macOS dictionaries",
  "settings.field.spelling.autocomplete.label": "Word Autocomplete",
  "settings.field.spelling.autocomplete.description":
    "Show predicted word completions as inline hints: Tab accepts with a space, Right without",
  "settings.field.composer.predictions.label": "Composer Predictions",
  "settings.field.composer.predictions.description":
    "After a completed turn, ask the active model to predict your next message and show it as ghost text in the empty composer; Tab or Right inserts it without sending. Extra usage: every completed turn sends one more billed request over the whole conversation (counted in /stats)",
  "settings.field.spelling.autocorrect.label": "Autocorrect (macOS)",
  "settings.field.spelling.autocorrect.description":
    "Apply confident macOS spelling corrections after completed words",
  "settings.field.emojiAutocomplete.label": "Emoji Autocomplete",
  "settings.field.emojiAutocomplete.description":
    "Suggest emojis from `:name:` shortcodes and expand text emoticons like `:D` or `:-)`",
  "settings.field.paste.largeMenuThreshold.label": "Large Paste Menu",
  "settings.field.paste.largeMenuThreshold.description":
    "When a paste reaches this many lines, offer a menu to wrap it in a code block, wrap it in XML tags, or save it to a file. 0 disables the menu (large pastes still collapse to a [Paste] marker).",

  "settings.field.tools.approval.label": "Tool Approval Policies",
  "settings.field.tools.approval.description":
    "Per-tool approval policies. Set to 'allow' to auto-approve, 'prompt' to require confirmation, or 'deny' to block. Overrides are honored in every approval mode.",
  "settings.field.tools.approvalMode.label": "Tool Approval",
  "settings.field.tools.approvalMode.description":
    "Default approval behavior for tool calls. 'Always ask' auto-approves read-only tools only. 'Write' auto-approves read and workspace-write tools. 'Yolo' auto-approves all tiers; user policy may still prompt or block.",

  "settings.field.completion.notify.label": "Completion Notification",
  "settings.field.completion.notify.description": "Notify when the agent finishes a turn",
  "settings.field.error.notify.label": "Error Notification",
  "settings.field.error.notify.description": "Notify when the agent stops with an error",
  "settings.field.ask.timeout.label": "Ask Timeout",
  "settings.field.ask.timeout.description":
    "Auto-select the recommended ask option after this many seconds (0 disables). Also bounds cfg:// approval prompts; an unanswered approval denies the write instead of auto-selecting",
  "settings.field.ask.notify.label": "Ask Notification",
  "settings.field.ask.notify.description": "Notify when the ask tool is waiting for input",
  "settings.field.recap.enabled.label": "Idle Recap",
  "settings.field.recap.enabled.description":
    "Generate a brief LLM recap of where things stand after the terminal has been idle",
  "settings.field.recap.idleSeconds.label": "Idle Recap Delay",
  "settings.field.recap.idleSeconds.description":
    "Seconds to wait while idle before showing the recap",

  "settings.field.stt.enabled.label": "Speech-to-Text",
  "settings.field.stt.enabled.description": "Enable speech-to-text input via microphone",
  "settings.field.stt.submitTrigger.label": "Speech-to-Text Submit Trigger",
  "settings.field.stt.submitTrigger.description":
    "Choose when speech dictation automatically submits: Never, Release (2+ words), Release with complete sentence, or When I Say Submit.",

  "settings.field.collab.relayUrl.label": "Relay URL",
  "settings.field.collab.relayUrl.description": "Relay used by /collab (wss://host[:port])",
  "settings.field.collab.webUrl.label": "Web UI URL",
  "settings.field.collab.webUrl.description":
    "Browser UI used by /collab links; empty derives from collab.relayUrl; explicit http:// is localhost-only",
  "settings.field.collab.displayName.label": "Display Name",
  "settings.field.collab.displayName.description":
    "Name shown to other collab participants (default: OS username)",
  "settings.field.collab.autoStart.label": "Auto Start",
  "settings.field.collab.autoStart.description":
    "Host every interactive session via collab.relayUrl as it starts and publish it to the local registry (omp collab list); rooms rotate on session switch",
  "settings.field.share.serverUrl.label": "Share Server",
  "settings.field.share.serverUrl.description":
    "Share viewer/upload base used by /share (encrypted blob upload + viewer; links are <base>/<id>#<key>)",
  "settings.field.share.store.label": "Share Store",
  "settings.field.share.store.description": "Where /share uploads the encrypted session blob",
  "settings.field.share.redactSecrets.label": "Share Secret Redaction",
  "settings.field.share.redactSecrets.description":
    "Run the secret obfuscator over /share snapshots before upload (uses the secrets.* config)",

  "settings.field.stream.serverUrl.label": "Stream Server",
  "settings.field.stream.serverUrl.description":
    "Live stream server used by `omp stream` (https://host[:port]); viewers watch at <base>/<your Stencil username>",

  "settings.field.magicKeywords.enabled.label": "Magic Keywords",
  "settings.field.magicKeywords.enabled.description":
    "Enable hidden notices for standalone ultrathink, orchestrate, workflowz, jevify keywords",
  "settings.field.magicKeywords.ultrathink.label": "Ultrathink Keyword",
  "settings.field.magicKeywords.ultrathink.description":
    "Let standalone ultrathink request maximum automatic thinking and append its hidden notice",
  "settings.field.magicKeywords.orchestrate.label": "Orchestrate Keyword",
  "settings.field.magicKeywords.orchestrate.description":
    "Let standalone orchestrate append its hidden multi-agent orchestration notice",
  "settings.field.magicKeywords.workflow.label": "Workflow Keyword",
  "settings.field.magicKeywords.workflow.description":
    "Let standalone workflowz append its hidden eval workflow notice",
  "settings.field.magicKeywords.jevify.label": "Jevify Keyword",
  "settings.field.magicKeywords.jevify.description":
    "Let standalone jevify append its hidden bulk-judge classification notice",

  "settings.field.autoResume.label": "Auto Resume",
  "settings.field.autoResume.description":
    "Automatically resume the most recent session in the current directory",
  "settings.field.startup.quiet.label": "Quiet Startup",
  "settings.field.startup.quiet.description": "Skip welcome screen and startup status messages",
  "settings.field.startup.showSplash.label": "Show Startup Splash",
  "settings.field.startup.showSplash.description":
    "Show the full animated setup splash on normal interactive startup without rerunning setup. Quiet Startup still suppresses it.",
  "settings.field.startup.setupWizard.label": "Setup Wizard",
  "settings.field.startup.setupWizard.description":
    "Show newly added onboarding steps once per setup version",
  "settings.field.startup.checkUpdate.label": "Check for Updates",
  "settings.field.startup.checkUpdate.description": "Check for omp updates on startup",
  "settings.field.update.channel.label": "Update Channel",
  "settings.field.update.channel.description":
    "Update channel used by omp update and the startup update check",
  "settings.field.marketplace.autoUpdate.label": "Marketplace Auto-Update",
  "settings.field.marketplace.autoUpdate.description": "Check for plugin updates on startup",
  "settings.field.startup.changelogMode.label": "Startup Changelog",
  "settings.field.startup.changelogMode.description":
    "Choose whether update notes start as a summary, full details, or stay hidden",

  "settings.field.power.sleepPrevention.label": "Sleep Prevention",
  "settings.field.power.sleepPrevention.description":
    "Prevent the system sleeping during active sessions. Each level is cumulative — it adds the flags of all lower levels.",

  "settings.field.features.unexpectedStopDetection.label": "Unexpected Stops",
  "settings.field.features.unexpectedStopDetection.description":
    "Automatically recover when the assistant stops without a visible message. Smart also classifies text-only stops with a small model.",

  "settings.field.git.enabled.label": "Enable Git Integration",
  "settings.field.git.enabled.description":
    "Show git branch, status, and PR information in the TUI and watch repository metadata.",

  "settings.field.skills.registryUrl.label": "Skill Registry",
  "settings.field.skills.registryUrl.description":
    "Skillshare registry used by `omp skill` to install, search, and publish skills (https://host[:port])",

  "settings.field.task.isolation.enabled.label": "Isolate Subagents",
  "settings.field.task.isolation.enabled.description":
    "Run subagents in an isolated copy of the checkout and integrate their changes afterwards",
  "settings.field.isolation.backend.label": "Isolation Backend",
  "settings.field.isolation.backend.description":
    "Backend used for subagent isolation and worktree cloning",
  "settings.field.worktree.clone.label": "Clone Checkout into Worktrees",
  "settings.field.worktree.clone.description":
    "New worktrees from `github pr_checkout` and `git worktree add` in bash start as a copy-on-write clone of the current checkout so ignored build artifacts (node_modules, target) carry over; falls back to a plain checkout when the filesystem cannot clone",
  "settings.field.worktree.cleanSource.label": "Clean Source Checkout on /wt",
  "settings.field.worktree.cleanSource.description":
    "When creating a worktree with `/wt`, reset tracked changes and remove untracked files from the original checkout after carrying them over",
  "settings.field.worktree.onStart.label": "Worktree on Start",
  "settings.field.worktree.onStart.description":
    "Whether fresh interactive sessions start in a new linked worktree",
  "settings.field.worktree.onExit.label": "Worktree on Exit",
  "settings.field.worktree.onExit.description":
    "What to do on exit with worktrees created since omp started (on start or with `/wt`)",
  "settings.field.task.isolation.apply.label": "Apply Isolated Changes",
  "settings.field.task.isolation.apply.description":
    "Automatically apply successful isolated task changes to the parent checkout; disable to retain patch or branch artifacts",
  "settings.field.task.isolation.merge.label": "Isolation Merge Strategy",
  "settings.field.task.isolation.merge.description":
    "How isolated task changes are integrated (patch apply or branch merge)",
  "settings.field.task.isolation.commits.label": "Isolation Commit Style",
  "settings.field.task.isolation.commits.description":
    "Commit message style for nested repo changes (generic or AI-generated)",
  "settings.field.worktree.base.label": "Worktree Base Directory",
  "settings.field.worktree.base.description":
    "Base directory for agent-managed worktrees — task-isolation copies, `github` PR checkouts, and `omp worktree` cleanup all live here. Unset uses ~/.omp/wt. Must be an absolute or ~-relative path; relative paths are ignored. The OMP_WORKTREE_DIR env var overrides this.",

  "settings.field.task.eager.label": "Prefer Task Delegation",
  "settings.field.task.eager.description": "How strongly to push delegating work to subagents",
  "settings.field.task.batch.label": "Batch Task Calls",
  "settings.field.task.batch.description":
    "Switch the task tool to its batch shape: one call carries { context, tasks[] } — one subagent per item, with an optional per-item agent (defaulting to the session spawn-policy agent), per-item isolation, and a required shared context prepended to every assignment. With async.enabled=true, each spawn runs as an independent background agent with the normal idle/parked lifecycle; otherwise the call blocks for merged results. Disable to restore the flat single-spawn schema.",
  "settings.field.task.structured.label": "Structured Task Results",
  "settings.field.task.structured.description":
    "Expose outputSchema/schemaMode on the task tool and return subagent results through the yield tool, validated against caller or agent output schemas. Off: task subagents have no yield tool and return their final message as plain text. Eval agent()/workpool spawns always keep structured results.",
  "settings.field.task.speculativeLaunch.label": "Speculative Task Launch",
  "settings.field.task.speculativeLaunch.description":
    "Start each batch subagent as soon as its tasks[] item finishes streaming instead of waiting for the whole task call. Launched agents are aborted if the finished call fails validation, is blocked, or its arguments change. Requires auto-allowed task approval and no extension tool lifecycle handlers.",
  "settings.field.task.enableEffort.label": "Per-Task Effort",
  "settings.field.task.enableEffort.description":
    "Expose the optional effort parameter on task spawns, allowing callers to override each subagent's thinking level",
  "settings.field.task.maxConcurrency.label": "Max Concurrent Tasks",
  "settings.field.task.maxConcurrency.description":
    "Maximum number of subagents running concurrently",
  "settings.field.task.enableLsp.label": "LSP in Subagents",
  "settings.field.task.enableLsp.description":
    "Allow subagents spawned via the task tool to use the lsp tool. Off by default to keep subagents cheap; enable when LSP-aware delegation is worth the extra tokens.",
  "settings.field.task.maxRecursionDepth.label": "Max Task Recursion",
  "settings.field.task.maxRecursionDepth.description":
    "How many levels deep subagents can spawn their own subagents",
  "settings.field.task.maxRuntimeMs.label": "Max Subagent Runtime",
  "settings.field.task.maxRuntimeMs.description":
    "Hard wall-clock limit per subagent (ms). 0 disables it. Defense-in-depth against provider-side stream hangs that escape the inference-layer watchdog; triggers a normal subagent abort with a 'timed out' reason.",
  "settings.field.task.completionProbe.label": "Subagent Completion Probe",
  "settings.field.task.completionProbe.description":
    "Ask a working subagent, through a cached side request like /btw, to estimate how complete its task is: after 2, 5, 10 and 30 more minutes, then hourly. The estimate shows next to the subagent in wait and task views. Only subagents spawned by the main agent of an interactive session are asked; print, RPC, ACP and SDK runs never probe.",
  "settings.field.task.softRequestBudget.label": "Soft Subagent Request Budget",
  "settings.field.task.softRequestBudget.description":
    "Soft per-subagent request budget (assistant requests per run). Crossing it injects a wrap-up steering notice (see task.softRequestBudgetNotice); at 1.5x the budget the run is force-stopped and the agent must hand back its partial findings. 0 disables the guard. Bundled scout/sonic agents cap out at a lower built-in budget, so a value below that cap still applies to them. A task.agentSoftRequestBudget entry replaces this budget for the agent it names.",
  "settings.field.task.softRequestBudgetNotice.label": "Soft Request Budget Notice",
  "settings.field.task.softRequestBudgetNotice.description":
    "Inject one steering notice when a subagent crosses its soft request budget, asking it to wrap up before the 1.5x forced-yield stop.",
  "settings.field.task.maxEffort.label": "Maximum Per-Spawn Effort",
  "settings.field.task.maxEffort.description":
    "Maximum reasoning effort allowed for the task tool's per-spawn effort hint. Lower values prevent callers from escalating subagents above this ceiling; the default preserves the model's full range.",
  "settings.field.task.prewalk.label": "Generic Task Prewalk",
  "settings.field.task.prewalk.description":
    "Arm prewalk for the bundled generic `task` subagent: it starts on its resolved model, plans and begins the implementation, then hands off to the 'smol' role at its first edit/write. Per-agent overrides (task.agentPrewalk, configured from the /agents hub) and user agent `prewalk` frontmatter apply regardless of this toggle.",

  "settings.field.plan.enabled.label": "Plan Mode",
  "settings.field.plan.enabled.description":
    "Enable plan mode for read-only exploration and planning before execution",
  "settings.field.plan.defaultOnStartup.label": "Start in Plan Mode",
  "settings.field.plan.defaultOnStartup.description":
    "Automatically enter plan mode at the start of every new session",
  "settings.field.plan.autosave.label": "Autosave Plans",
  "settings.field.plan.autosave.description":
    "Automatically save approved plans to disk when plan mode completes",
  "settings.field.plan.autosaveDir.label": "Autosave Directory",
  "settings.field.plan.autosaveDir.description":
    "Directory for autosaved plans. Supports ~, absolute, and cwd-relative paths. Empty uses <project>/.omp/plans/.",
  "settings.field.goal.enabled.label": "Goal Mode",
  "settings.field.goal.enabled.description":
    "Enable per-session goal mode and the hidden goal tool",
  "settings.field.goal.statusInFooter.label": "Goal Status in Footer",
  "settings.field.goal.statusInFooter.description":
    "Show token budget alongside the goal indicator in the status line",
  "settings.field.title.generator.label": "Title Generator",
  "settings.field.title.generator.description":
    "What names an untitled session from the user's messages",
  "settings.field.title.refreshOnReplan.label": "Refresh Title on Replan",
  "settings.field.title.refreshOnReplan.description":
    "Refresh generated session titles after todo init replans unless the title was set by the user",

  "settings.field.skills.enableSkillCommands.label": "Skill Commands",
  "settings.field.skills.enableSkillCommands.description":
    "Register skills as /skill:name commands",
  "settings.field.commands.enableClaudeUser.label": "Claude User Commands",
  "settings.field.commands.enableClaudeUser.description": "Load commands from ~/.claude/commands/",
  "settings.field.commands.enableClaudeProject.label": "Claude Project Commands",
  "settings.field.commands.enableClaudeProject.description": "Load commands from .claude/commands/",
  "settings.field.commands.enableOpencodeUser.label": "OpenCode User Commands",
  "settings.field.commands.enableOpencodeUser.description":
    "Load commands from ~/.config/opencode/commands/",
  "settings.field.commands.enableOpencodeProject.label": "OpenCode Project Commands",
  "settings.field.commands.enableOpencodeProject.description":
    "Load commands from .opencode/commands/",
};
