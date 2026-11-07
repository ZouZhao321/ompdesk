/** omp 设置面板 tools 与 files 标签的英文文案。 */
export const toolsFiles: Record<string, string> = {
	"settings.group.tools.available-tools": "Available Tools",
	"settings.group.tools.todos": "Todos",
	"settings.group.tools.grep-browser": "Grep & Browser",
	"settings.group.tools.computer": "Computer",
	"settings.group.tools.ida-pro": "IDA Pro",
	"settings.group.tools.github": "GitHub",
	"settings.group.tools.output-limits": "Output Limits",
	"settings.group.tools.execution": "Execution",
	"settings.group.tools.discovery-mcp": "Discovery & MCP",
	"settings.group.tools.extensions": "Extensions",
	"settings.group.tools.developer": "Developer",
	"settings.group.files.editing": "Editing",
	"settings.group.files.reading": "Reading",
	"settings.group.files.read-summaries": "Read Summaries",
	"settings.group.files.lsp": "LSP",

	"settings.field.todo.enabled.label": "Todos",
	"settings.field.todo.enabled.description": "Enable the todo tool for task tracking",
	"settings.field.glob.enabled.label": "Glob",
	"settings.field.glob.enabled.description": "Enable the glob tool for glob-based file lookup",
	"settings.field.grep.enabled.label": "Grep",
	"settings.field.grep.enabled.description": "Enable the grep tool for regex content search",
	"settings.field.astGrep.enabled.label": "AST Grep",
	"settings.field.astGrep.enabled.description": "Enable the ast_grep tool for structural AST search",
	"settings.field.astEdit.enabled.label": "AST Edit",
	"settings.field.astEdit.enabled.description": "Enable the ast_edit tool for structural AST rewrites",
	"settings.field.find.enabled.label": "Find (semantic grep)",
	"settings.field.find.enabled.description":
		"Enable the find tool: natural-language search for files and line ranges, judged by the judge model role. Auto enables it only when the judge role resolves to a native TypeSafe jev model",
	"settings.field.debug.enabled.label": "Debug",
	"settings.field.debug.enabled.description": "Enable the debug tool for DAP-based debugging",
	"settings.field.launch.enabled.label": "Services",
	"settings.field.launch.enabled.description":
		"Enable named bash services and proc:// supervision for shared long-running project processes",
	"settings.field.speechgen.enabled.label": "Speech Generation",
	"settings.field.speechgen.enabled.description":
		"Enable the tts tool for on-device (Kokoro) or xAI Grok Voice speech-file synthesis",
	"settings.field.generate_image.enabled.label": "Generate Image",
	"settings.field.generate_image.enabled.description":
		"Enable the generate_image tool (text-to-image generation and editing). Exposed as an xd:// device when tools.xdev is on.",
	"settings.field.computer.enabled.label": "Computer",
	"settings.field.computer.enabled.description":
		"Enable the scriptable host-desktop eval prelude (screenshots, input, accessibility)",
	"settings.field.ratchet.enabled.label": "Ratchet",
	"settings.field.ratchet.enabled.description":
		"Enable the ratchet eval/hillclimb prelude; /ratchet turns it on for the current session",
	"settings.field.archive.enabled.label": "Archive",
	"settings.field.archive.enabled.description":
		"Enable the read-only archive eval prelude: prompt history, recent projects, past sessions and recaps",
	"settings.field.checkpoint.enabled.label": "Checkpoint/Rewind",
	"settings.field.checkpoint.enabled.description": "Enable the checkpoint and rewind tools for context checkpointing",
	"settings.field.fetch.enabled.label": "Read URLs",
	"settings.field.fetch.enabled.description": "Allow the read tool to fetch and process URLs",
	"settings.field.vault.enabled.label": "Obsidian Vault",
	"settings.field.vault.enabled.description":
		"Enable the vault:// internal URL for reading and editing Obsidian vault content via the Obsidian CLI. When disabled, vault:// resolution is refused and the vault:// entry is omitted from the system prompt.",
	"settings.field.github.enabled.label": "GitHub CLI",
	"settings.field.github.enabled.description":
		"Enable the github tool (op-based dispatch for repository, issue, pull request, diff, search, checkout, push, and Actions watch workflows)",
	"settings.field.web_search.enabled.label": "Web Search",
	"settings.field.web_search.enabled.description": "Enable the web_search tool for live web results",
	"settings.field.security.enabled.label": "Security",
	"settings.field.security.enabled.description":
		"Enable OMP-native security scan planning, execution, and the read-only security:// resource namespace",
	"settings.field.ask.enabled.label": "Ask",
	"settings.field.ask.enabled.description": "Enable the ask tool for interactive user questions",
	"settings.field.browser.enabled.label": "Browser",
	"settings.field.browser.enabled.description":
		"Enable the browser eval prelude for scripted Chromium automation (Puppeteer)",
	"settings.field.ida.enabled.label": "IDA Pro",
	"settings.field.ida.enabled.description":
		"Open executables read with `read` in IDA Pro (idalib) and enable the `ida` tool; inert when no IDA install is found",

	"settings.field.todo.reminders.label": "Todo Reminders",
	"settings.field.todo.reminders.description": "Remind the agent to complete todos before stopping",
	"settings.field.todo.remindersMax.label": "Todo Reminder Limit",
	"settings.field.todo.remindersMax.description": "Maximum number of todo reminders before giving up",
	"settings.field.todo.eager.label": "Create Todos Automatically",
	"settings.field.todo.eager.description": "How strongly to push automatic todo-list creation after the first message",
	"settings.field.tasks.todoClearDelay.label": "Todo Auto-Clear Delay",
	"settings.field.tasks.todoClearDelay.description":
		"Delay before completed or abandoned todos are removed from the todo widget",

	"settings.field.grep.contextBefore.label": "Grep Context Before",
	"settings.field.grep.contextBefore.description": "Lines of context before each grep match",
	"settings.field.grep.contextAfter.label": "Grep Context After",
	"settings.field.grep.contextAfter.description": "Lines of context after each grep match",
	"settings.field.browser.cdpUrl.label": "Browser CDP URL",
	"settings.field.browser.cdpUrl.description":
		"Default HTTP CDP discovery endpoint (for example http://127.0.0.1:9222) to attach to instead of launching a browser. Explicit app.cdp_url or app.path on the tool call take precedence.",
	"settings.field.browser.relay.label": "Browser Relay",
	"settings.field.browser.relay.description":
		"Drive your own Chrome tabs through the omp browser relay. Install the extension once (`omp browser-relay install`); the relay server auto-starts when the browser prelude needs it. Takes precedence over Browser CDP URL; set PI_BROWSER_RELAY=0 or PI_BROWSER_RELAY=1 to override.",
	"settings.field.browser.relayUrl.label": "Browser Relay URL",
	"settings.field.browser.relayUrl.description": "omp browser relay endpoint (default http://127.0.0.1:9224).",
	"settings.field.browser.headless.label": "Headless Browser",
	"settings.field.browser.headless.description": "Launch browser in headless mode (disable to show browser UI)",
	"settings.field.browser.cmux.label": "cmux Browser",
	"settings.field.browser.cmux.description":
		"Use cmux WKWebView surfaces for browser automation when a cmux socket is available. Set PI_BROWSER_CMUX=0 or PI_BROWSER_CMUX=1 to override.",
	"settings.field.browser.tern.label": "Tern Browser",
	"settings.field.browser.tern.description":
		"Inside a Tern pane, open browser tabs as picture-in-pictures over omp's pane (native web view) instead of headless Chromium; falls back to Chromium when no Tern window can host them. Explicit app options, the relay and Browser CDP URL take precedence; app.tern:false opts one open out. Set PI_BROWSER_TERN=0 or PI_BROWSER_TERN=1 to override.",
	"settings.field.browser.freezeOnTurnEnd.label": "Freeze Browser Tabs On Turn End",
	"settings.field.browser.freezeOnTurnEnd.description":
		"Freeze OMP-owned headless browser tabs when a turn settles so animated pages stop burning CPU/GPU while idle. Tabs unfreeze automatically on next use; pass persist:true on open to opt a tab out.",
	"settings.field.browser.idleCloseSec.label": "Browser Idle Close Timeout",
	"settings.field.browser.idleCloseSec.description":
		"Close OMP-owned headless browser tabs and Tern browser picture-in-pictures idle longer than this many seconds (0 = never; session dispose still reaps). Never touches relay/CDP/spawned browsers or other sessions' tabs.",
	"settings.field.browser.screenshotDir.label": "Screenshot Directory",
	"settings.field.browser.screenshotDir.description":
		"Directory to save screenshots. If unset, screenshots go to a temp file. Supports ~. Examples: ~/Downloads, ~/Desktop, /sdcard/Download (Android)",

	"settings.field.computer.display.label": "Computer Display",
	"settings.field.computer.display.description":
		"Active window's display (active), all displays (all), or a native display id",

	"settings.field.ida.python.label": "IDA Python",
	"settings.field.ida.python.description":
		"Python interpreter that can import ida_domain and idapro; empty auto-detects",
	"settings.field.ida.installDir.label": "IDA Install Dir",
	"settings.field.ida.installDir.description":
		"Directory containing libidalib, exported as IDADIR; empty auto-detects ($IDADIR, ida-config.json, standard install paths)",
	"settings.field.ida.maxOpen.label": "IDA Max Open Databases",
	"settings.field.ida.maxOpen.description":
		"Most IDA databases (omp.ida.* daemons in omp ps) open at once per project; opening another saves and closes the least recently used idle one",
	"settings.field.ida.idleCloseSec.label": "IDA Idle Close Timeout",
	"settings.field.ida.idleCloseSec.description":
		"Save and close IDA databases idle longer than this many seconds (0 = never); the exec namespace resets on reopen",

	"settings.field.github.cache.enabled.label": "GitHub View Cache",
	"settings.field.github.cache.enabled.description":
		"Cache rendered issue/PR view output in ~/.omp/cache/github-cache.db so repeated reads are free",

	"settings.field.tools.artifactSpillThreshold.label": "Artifact Spill Threshold (KB)",
	"settings.field.tools.artifactSpillThreshold.description":
		"Tool output above this size is saved as an artifact; tail is kept inline",
	"settings.field.tools.artifactTailBytes.label": "Artifact Tail Size (KB)",
	"settings.field.tools.artifactTailBytes.description":
		"Amount of tail content kept inline when output spills to artifact",
	"settings.field.tools.artifactHeadBytes.label": "Artifact Head Size (KB)",
	"settings.field.tools.artifactHeadBytes.description":
		"Amount of head content kept inline alongside the tail when output spills to artifact (middle elision). 0 disables — keep tail only.",
	"settings.field.tools.outputMaxColumns.label": "Output Column Cap",
	"settings.field.tools.outputMaxColumns.description":
		"Per-line byte cap for streaming tool outputs (bash, python, js eval) and `read`. Lines wider than this are ellipsis-truncated; remaining bytes up to the next newline are dropped. 0 disables.",
	"settings.field.tools.artifactTailLines.label": "Artifact Tail Lines",
	"settings.field.tools.artifactTailLines.description":
		"Maximum lines of tail content kept inline when output spills to artifact",
	"settings.field.tools.artifactMaxBytes.label": "Artifact File Cap (MB)",
	"settings.field.tools.artifactMaxBytes.description":
		"Maximum size of the artifact file saved for streaming tool output (bash, python, js eval). Larger output keeps its beginning (up to 3 MB) and its most recent remainder, with a truncation notice between them. 0 = unlimited.",

	"settings.field.images.questionTimeoutMs.label": "Image Question Timeout",
	"settings.field.images.questionTimeoutMs.description":
		"Per-request timeout for the vision-model call behind read's ?q= image questions, in milliseconds. A stalled provider fails fast with a timeout error instead of blocking until manual abort. Set to 0 to disable the timeout.",
	"settings.field.tools.intentTracing.label": "Intent Tracing",
	"settings.field.tools.intentTracing.description":
		"Ask the agent to describe the intent of each tool call before executing it",
	"settings.field.tools.abortOnFabricatedResult.label": "Abort On Fabricated Tool Result",
	"settings.field.tools.abortOnFabricatedResult.description":
		"With in-band tool calls, stop the model immediately when it starts hallucinating a tool result mid-turn. Disable to let the model finish generating and discard the fabricated continuation instead.",
	"settings.field.tools.speculativeExecution.enabled.label": "Experimental Speculative Execution",
	"settings.field.tools.speculativeExecution.enabled.description":
		"Enable the discard-safe first slice: validated local reads through direct read calls and nested eval. Network requests, provider completions, and live filesystem writes are not part of this baseline.",
	"settings.field.tools.speculativeExecution.maxInFlight.label": "Speculative Execution Concurrency",
	"settings.field.tools.speculativeExecution.maxInFlight.description":
		"Maximum number of validated local reads allowed to run before normal dispatch.",
	"settings.field.tools.maxTimeout.label": "Max Tool Timeout",
	"settings.field.tools.maxTimeout.description":
		"Maximum timeout in seconds the agent can set for any tool (0 = no limit)",
	"settings.field.async.enabled.label": "Async Execution",
	"settings.field.async.enabled.description": "Enable async bash commands and background task execution",

	"settings.field.tools.xdev.label": "xd:// Tools",
	"settings.field.tools.xdev.description":
		"Mount rarely-used (discoverable) tools under xd:// device URLs driven via read/write instead of shipping their schemas on every request. Sessions whose explicit tool list grants read but omits write mount devices through a device-only write transport (only local:// scratch stays writable besides devices). Disable to expose every enabled tool top-level.",
	"settings.field.tools.xdevDocs.label": "xd:// Prompt Docs",
	"settings.field.tools.xdevDocs.description":
		"Choose which mounted-device docs and schemas are inlined in the system prompt. Built-ins keeps core tools inline while MCP and extension tools stay on-demand.",
	"settings.field.mcp.enableProjectConfig.label": "MCP Project Config",
	"settings.field.mcp.enableProjectConfig.description": "Load .mcp.json/mcp.json from project root",
	"settings.field.mcp.renderMarkdownResults.label": "MCP Markdown Results",
	"settings.field.mcp.renderMarkdownResults.description":
		"Render non-JSON MCP text results as Markdown in the transcript",
	"settings.field.mcp.notifications.label": "MCP Update Injection",
	"settings.field.mcp.notifications.description": "Inject MCP resource updates into the agent conversation",

	"settings.field.dev.autoqa.label": "Auto QA",
	"settings.field.dev.autoqa.description":
		"Automated tool issue reporting (xd://report_issue). On by default; the first report asks for consent, and denying it disables reporting until re-enabled explicitly",
	"settings.field.dev.autoqaPush.endpoint.label": "Auto QA Push Endpoint",
	"settings.field.dev.autoqaPush.endpoint.description":
		"Full URL receiving Auto QA JSON reports (default https://qa.omp.sh/v1/grievances)",

	"settings.field.edit.mode.label": "Edit Mode",
	"settings.field.edit.mode.description": "Select the edit tool variant (replace, patch, hashline, or apply_patch)",
	"settings.field.edit.fuzzyMatch.label": "Fuzzy Match",
	"settings.field.edit.fuzzyMatch.description": "Accept high-confidence fuzzy matches for whitespace differences",
	"settings.field.edit.fuzzyThreshold.label": "Fuzzy Match Threshold",
	"settings.field.edit.fuzzyThreshold.description": "Similarity threshold (0-1) for accepting fuzzy matches",
	"settings.field.edit.streamingAbort.label": "Abort on Failed Preview",
	"settings.field.edit.streamingAbort.description": "Abort streaming edit tool calls when patch preview fails",
	"settings.field.edit.recoverInlineEdits.label": "Recover Inline Edit Payloads",
	"settings.field.edit.recoverInlineEdits.description":
		"Execute edit payloads the model emits as plain text by converting them into edit tool calls",
	"settings.field.edit.blockAutoGenerated.label": "Block Auto-Generated Files",
	"settings.field.edit.blockAutoGenerated.description":
		"Prevent editing of files that appear to be auto-generated (protoc, sqlc, swagger, etc.)",
	"settings.field.edit.enforceSeenLines.label": "Enforce Seen-Line Guard",
	"settings.field.edit.enforceSeenLines.description":
		"Reject edits anchored on lines a prior read/search never displayed in full",
	"settings.field.edit.blackbox.enabled.label": "Record Parse Regressions",
	"settings.field.edit.blackbox.enabled.description":
		"Append full before/after source when an edit introduces an AST parse failure",
	"settings.field.edit.autoRepair.enabled.label": "Auto-Repair Parse Regressions",
	"settings.field.edit.autoRepair.enabled.description":
		"When an edit breaks a file's AST parse, ask the smol model to fix the broken region (validated by re-parse; falls back to a warning)",

	"settings.field.readLineNumbers.label": "Line Numbers",
	"settings.field.readLineNumbers.description": "Prepend line numbers to read tool output by default",
	"settings.field.read.defaultLimit.label": "Default Read Limit",
	"settings.field.read.defaultLimit.description":
		"Default number of lines returned when agent calls read without a limit",
	"settings.field.read.renderMarkdown.label": "Markdown Previews",
	"settings.field.read.renderMarkdown.description":
		"Render Markdown read results as formatted terminal Markdown previews instead of raw source",
	"settings.field.read.toolResultPreview.label": "Inline Read Previews",
	"settings.field.read.toolResultPreview.description":
		"Render read tool results inline in the transcript instead of summary rows",

	"settings.field.read.summarize.enabled.label": "Read Summaries",
	"settings.field.read.summarize.enabled.description":
		"Return structural code summaries when read is called without an explicit selector",
	"settings.field.read.summarize.prose.label": "Prose Summaries",
	"settings.field.read.summarize.prose.description": "Return structural summaries for Markdown and plain text reads",

	"settings.field.lsp.enabled.label": "LSP",
	"settings.field.lsp.enabled.description":
		"Enable the lsp tool for code intelligence (definitions, references, diagnostics, rename)",
	"settings.field.lsp.lazy.label": "Lazy LSP Startup",
	"settings.field.lsp.lazy.description":
		"Start language servers on first use (lsp tool or editing a matching file type) instead of at session startup",
	"settings.field.lsp.shared.label": "Shared Language Servers",
	"settings.field.lsp.shared.description":
		"Share one language server per project across omp instances via the daemon broker (falls back to private servers when unavailable)",
	"settings.field.lsp.formatOnWrite.label": "Format on Write",
	"settings.field.lsp.formatOnWrite.description": "Automatically format code files using LSP after writing",
	"settings.field.lsp.diagnosticsOnWrite.label": "Diagnostics on Write",
	"settings.field.lsp.diagnosticsOnWrite.description": "Return LSP diagnostics after writing code files",
	"settings.field.lsp.diagnosticsOnEdit.label": "Diagnostics on Edit",
	"settings.field.lsp.diagnosticsOnEdit.description": "Return LSP diagnostics after editing code files",
	"settings.field.lsp.diagnosticsDeduplicate.label": "Deduplicate Diagnostics",
	"settings.field.lsp.diagnosticsDeduplicate.description":
		"Suppress post-edit LSP diagnostics already shown for a file; only surface new or changed ones",
};
