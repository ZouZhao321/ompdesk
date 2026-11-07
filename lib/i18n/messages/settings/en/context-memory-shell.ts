/** shell、context 与 memory 标签的英文文案。 */
export const contextMemoryShell: Record<string, string> = {
  "settings.group.shell.bash": "Bash",
  "settings.group.shell.eval-runtimes": "Eval & Runtimes",

  "settings.field.bash.enabled.label": "Bash",
  "settings.field.bash.enabled.description": "Enable the bash tool for shell command execution",
  "settings.field.bash.allowCompoundCommands.label": "Allow Compound Commands",
  "settings.field.bash.allowCompoundCommands.description":
    "Evaluate literal && chains per command; unmatched commands use normal bash approval policy and mode",
  "settings.field.bash.autoBackground.enabled.label": "Bash Auto-Background",
  "settings.field.bash.autoBackground.enabled.description":
    "Automatically background long-running bash commands and deliver the result later",
  "settings.field.bash.gitGuard.label": "Git Guard",
  "settings.field.bash.gitGuard.description":
    "Refuse git commands that discard or move shared work in the bash tool: stash, reset --hard or to another commit, and checkout/switch/restore outside a merge or rebase conflict",
  "settings.field.bashInterceptor.enabled.label": "Bash Interceptor",
  "settings.field.bashInterceptor.enabled.description": "Block shell commands that have dedicated tools",
  "settings.field.bash.direnv.label": "direnv Auto-Load",
  "settings.field.bash.direnv.description":
    "Auto-load a repo's direnv/devenv `.envrc` into the bash session so devenv tools and env vars are present without manual `direnv exec`. Honors direnv's allow list: an `.envrc` you haven't `direnv allow`ed is never executed",

  "settings.field.shellMinimizer.enabled.label": "Shell Minimizer",
  "settings.field.shellMinimizer.enabled.description":
    "Compress verbose shell output (git, npm, cargo, etc.) before returning it to the agent",
  "settings.field.shellMinimizer.sourceOutlineLevel.label": "Shell Minimizer Source Outline",
  "settings.field.shellMinimizer.sourceOutlineLevel.description":
    "Source outline mode for cat/read of source files: default or aggressive",
  "settings.field.eval.py.label": "Python Eval Backend",
  "settings.field.eval.py.description": "Allow the eval tool to dispatch Python cells to the IPython kernel",
  "settings.field.eval.js.label": "JavaScript Eval Backend",
  "settings.field.eval.js.description": "Allow the eval tool to dispatch JavaScript cells to the in-process runtime",
  "settings.field.eval.autoProvision.label": "Eval Environment Provisioning",
  "settings.field.eval.autoProvision.description":
    "Automatically create the managed JavaScript eval package environment on first install",
  "settings.field.eval.tools.enabled.label": "Eval-Defined Tools",
  "settings.field.eval.tools.enabled.description":
    "Let eval cells define tools (@tool in Python, tool(fn) in JS) that task, agent(), and workpool() subagents can call",
  "settings.field.eval.workpool.freshAgents.label": "Fresh Workpool Agents",
  "settings.field.eval.workpool.freshAgents.description":
    "Spawn a new subagent for every workpool item instead of reusing workers or batching queued items",
  "settings.field.eval.autoBackground.enabled.label": "Eval Auto-Background",
  "settings.field.eval.autoBackground.enabled.description":
    "Automatically background long-running eval cells and deliver the result later",
  "settings.field.python.kernelMode.label": "Python Kernel Mode",
  "settings.field.python.kernelMode.description":
    "Keep the IPython kernel alive across eval calls or start fresh each time",
  "settings.field.python.interpreter.label": "Python Interpreter",
  "settings.field.python.interpreter.description":
    "Optional path to an exact Python executable. When set, automatic Python runtime discovery is skipped.",

  "settings.group.context.general": "General",
  "settings.group.context.compaction": "Compaction",
  "settings.group.context.rules-ttsr": "Rules (TTSR)",
  "settings.group.context.experimental": "Experimental",

  "settings.field.contextPromotion.enabled.label": "Auto-Promote Context",
  "settings.field.contextPromotion.enabled.description":
    "Promote to a larger-context model on context overflow instead of compacting",
  "settings.field.extendedContext.label": "Extended Context",
  "settings.field.extendedContext.description":
    "Use larger context windows where supported; may incur premium pricing. Off keeps default or standard-pricing windows",
  "settings.field.compaction.enabled.label": "Auto-Compact",
  "settings.field.compaction.enabled.description": "Automatically compact context when it gets too large",
  "settings.field.compaction.experimentalContextManagement.label": "Notes-backed context windows (experimental)",
  "settings.field.compaction.experimentalContextManagement.description":
    "Keep persistent notes and searchable raw history across context windows.",
  "settings.field.compaction.midTurnEnabled.label": "Mid-Turn Compaction",
  "settings.field.compaction.midTurnEnabled.description":
    "Check thresholds at safe mid-turn tool-loop boundaries before the next provider request; subagents always check, since their whole assignment is one turn",
  "settings.field.compaction.methodOrder.label": "Compaction Method Order",
  "settings.field.compaction.methodOrder.description":
    "Preferred fallback order for automatic context maintenance; unavailable or failed methods advance to the next choice",
  "settings.field.compaction.thresholdPercent.label": "Compaction Threshold",
  "settings.field.compaction.thresholdPercent.description":
    "Percent threshold for context maintenance; set to Default to use legacy reserve-based behavior",
  "settings.field.compaction.thresholdTokens.label": "Compaction Token Limit",
  "settings.field.compaction.thresholdTokens.description":
    "Fixed token limit for context maintenance; overrides percentage if set",
  "settings.field.compaction.handoffSaveToDisk.label": "Save Handoff Docs",
  "settings.field.compaction.handoffSaveToDisk.description":
    "Save generated handoff documents to markdown files for the auto-handoff flow",
  "settings.field.compaction.remoteStreamingV2Enabled.label": "Remote Compaction V2",
  "settings.field.compaction.remoteStreamingV2Enabled.description":
    "Use Responses streaming compaction for compatible remote compaction models",
  "settings.field.compaction.asyncEnabled.label": "Async Compaction",
  "settings.field.compaction.asyncEnabled.description":
    "Speculatively summarize in the background as context nears the compaction threshold, then splice the ready result in when the threshold is crossed",
  "settings.field.compaction.idleEnabled.label": "Idle Compaction",
  "settings.field.compaction.idleEnabled.description": "Compact context while idle when token count exceeds threshold",
  "settings.field.compaction.idleThresholdTokens.label": "Idle Compaction Threshold",
  "settings.field.compaction.idleThresholdTokens.description": "Token count above which idle compaction triggers",
  "settings.field.compaction.idleTimeoutSeconds.label": "Idle Compaction Delay",
  "settings.field.compaction.idleTimeoutSeconds.description": "Seconds to wait while idle before compacting",
  "settings.field.compaction.supersedeReads.label": "Supersede Stale Reads",
  "settings.field.compaction.supersedeReads.description":
    "Prune older read results when the same file is read again (cache-aware, runs every turn)",
  "settings.field.compaction.dropUseless.label": "Elide Uneventful Results",
  "settings.field.compaction.dropUseless.description":
    "Prune tool results flagged contextually useless (no matches, timed-out waits) once consumed (cache-aware)",
  "settings.field.snapcompact.systemPrompt.label": "Snapcompact System Prompt",
  "settings.field.snapcompact.systemPrompt.description":
    "Experimental: render selected system prompt text as dense PNG image(s) and attach to the first user message (vision models only). Saves tokens; loses prompt caching for imaged text.",
  "settings.field.snapcompact.toolResults.label": "Snapcompact Tool Results",
  "settings.field.snapcompact.toolResults.description":
    "Experimental: render large tool results, the newest one included, as dense PNG image(s) instead of text (vision models only). Saves tokens on accumulated search and command output; read results stay text unless the model is known to edit exactly from images.",
  "settings.field.tools.format.label": "Tool Calling Mode",
  "settings.field.tools.format.description":
    "Controls how tools are exposed to the model. Auto uses provider-native tool calls unless the selected model is marked as not supporting them, then falls back to the GLM owned dialect. Native forces provider-native tools; the other values force the named owned dialect.",
  "settings.field.snapcompact.shape.label": "Snapcompact Shape",
  "settings.field.snapcompact.shape.description":
    "Frame shape snapcompact prints text with (compaction archive and inline imaging). Auto picks a shape tuned for the current model.",
  "settings.field.branchSummary.enabled.label": "Branch Summaries",
  "settings.field.branchSummary.enabled.description": "Prompt to summarize when leaving a branch",
  "settings.field.ttsr.enabled.label": "TTSR",
  "settings.field.ttsr.enabled.description":
    "Interrupt the agent mid-stream when output matches rule patterns (Time-Traveling Stream Rules)",
  "settings.field.ttsr.judge.label": "Judged Rules",
  "settings.field.ttsr.judge.description":
    "Ask the judge model role each `question` rule about completed replies, reasoning, and tool calls; a yes injects the rule as a warning",
  "settings.field.ttsr.contextMode.label": "TTSR Context Mode",
  "settings.field.ttsr.contextMode.description": "What to do with partial output when TTSR triggers",
  "settings.field.ttsr.interruptMode.label": "TTSR Interrupt Mode",
  "settings.field.ttsr.interruptMode.description": "When to interrupt mid-stream vs inject warning after completion",
  "settings.field.ttsr.repeatMode.label": "TTSR Repeat Mode",
  "settings.field.ttsr.repeatMode.description": "How rules can repeat: once per session or after a message gap",
  "settings.field.ttsr.repeatGap.label": "TTSR Repeat Gap",
  "settings.field.ttsr.repeatGap.description": "Messages before a rule can trigger again",
  "settings.field.ttsr.builtinRules.label": "Built-in Rules",
  "settings.field.ttsr.builtinRules.description":
    "Load the default rules shipped with the agent (override individually with ttsr.disabledRules)",

  "settings.group.memory.general": "General",
  "settings.group.memory.auto-learn": "Auto-Learn",
  "settings.group.memory.mnemopi": "Mnemopi",
  "settings.group.memory.hindsight": "Hindsight",
  "settings.group.memory.sharpshooter": "Sharpshooter",

  "settings.field.memory.backend.label": "Memory Backend",
  "settings.field.memory.backend.description":
    "Off, local summary pipeline, Mnemopi SQLite, Hindsight remote memory, or Sharpshooter",
  "settings.field.sharpshooter.model.label": "Sharpshooter Model",
  "settings.field.sharpshooter.model.description": "Model selector for extraction/consolidation, empty = smol role",
  "settings.field.autolearn.enabled.label": "Auto-Learn (experimental)",
  "settings.field.autolearn.enabled.description":
    "After the agent stops, nudge it to capture lessons to memory and create/enhance isolated managed skills",
  "settings.field.autolearn.autoContinue.label": "Auto-run capture at stop",
  "settings.field.autolearn.autoContinue.description":
    "When on, auto-run one private capture turn at stop (uses extra tokens). When off, only standing auto-learn guidance remains.",
  "settings.field.mnemopi.dbPath.label": "Mnemopi DB Path",
  "settings.field.mnemopi.dbPath.description": "Optional SQLite DB path. Defaults to the agent memories directory.",
  "settings.field.mnemopi.bank.label": "Mnemopi Bank",
  "settings.field.mnemopi.bank.description":
    "Optional shared bank base name. Per-project modes derive project-local banks from it.",
  "settings.field.mnemopi.scoping.label": "Mnemopi Scoping",
  "settings.field.mnemopi.scoping.description":
    "global = one shared bank; per-project = isolated bank per cwd; per-project-tagged = project-local writes plus global recall visibility",
  "settings.field.mnemopi.embeddingVariant.label": "Embedding variant",
  "settings.field.mnemopi.embeddingVariant.description":
    "Local embedding model family. en = stronger English model; multilingual = cross-language model. Changing this rebuilds existing memory embeddings on next start.",
  "settings.field.mnemopi.autoRecall.label": "Mnemopi Auto Recall",
  "settings.field.mnemopi.autoRecall.description": "Recall local memories into the first turn of each session",
  "settings.field.mnemopi.autoRetain.label": "Mnemopi Auto Retain",
  "settings.field.mnemopi.autoRetain.description": "Retain completed conversation turns into local Mnemopi memory",
  "settings.field.mnemopi.polyphonicRecall.label": "Mnemopi Polyphonic Recall",
  "settings.field.mnemopi.polyphonicRecall.description":
    "Fuse recall with graph, fact, vector and temporal voices so linked memories surface without a keyword match",
  "settings.field.mnemopi.enhancedRecall.label": "Mnemopi Enhanced Recall",
  "settings.field.mnemopi.enhancedRecall.description":
    "Cache recall results for repeated and similar queries with identical options; any memory write clears it",
  "settings.field.mnemopi.proactiveLinking.label": "Mnemopi Proactive Linking",
  "settings.field.mnemopi.proactiveLinking.description":
    "Ingest new memories into the episodic graph as they are stored, linking them to related entities and memories",
  "settings.field.mnemopi.noEmbeddings.label": "Mnemopi Disable Embeddings",
  "settings.field.mnemopi.noEmbeddings.description": "Force deterministic FTS-only recall instead of vector embeddings",
  "settings.field.mnemopi.embeddingModel.label": "Mnemopi Embedding Model",
  "settings.field.mnemopi.embeddingModel.description":
    "Advanced: explicit embedding model id that overrides the variant. Leave empty to use mnemopi.embeddingVariant.",
  "settings.field.mnemopi.embeddingApiUrl.label": "Mnemopi Embedding API URL",
  "settings.field.mnemopi.embeddingApiUrl.description":
    "Optional OpenAI-compatible embedding endpoint passed to Mnemopi",
  "settings.field.mnemopi.embeddingApiKey.label": "Mnemopi Embedding API Key",
  "settings.field.mnemopi.embeddingApiKey.description": "Optional embedding API key passed to Mnemopi",
  "settings.field.mnemopi.llmMode.label": "Mnemopi LLM Mode",
  "settings.field.mnemopi.llmMode.description":
    "Use no LLM, the online tiny model (the TINY role from /models, else @smol), or a remote OpenAI-compatible endpoint",
  "settings.field.mnemopi.llmBaseUrl.label": "Mnemopi LLM Base URL",
  "settings.field.mnemopi.llmBaseUrl.description": "Optional OpenAI-compatible LLM endpoint for Mnemopi remote mode",
  "settings.field.mnemopi.llmApiKey.label": "Mnemopi LLM API Key",
  "settings.field.mnemopi.llmApiKey.description": "Optional LLM API key for Mnemopi remote mode",
  "settings.field.mnemopi.llmModel.label": "Mnemopi LLM Model",
  "settings.field.mnemopi.llmModel.description": "Optional LLM model name for Mnemopi remote mode",
  "settings.field.hindsight.apiUrl.label": "Hindsight API URL",
  "settings.field.hindsight.apiUrl.description": "Hindsight server URL (Cloud or self-hosted)",
  "settings.field.hindsight.apiToken.label": "Hindsight API Token",
  "settings.field.hindsight.apiToken.description": "Bearer token for authenticated Hindsight servers",
  "settings.field.hindsight.bankId.label": "Hindsight Bank ID",
  "settings.field.hindsight.bankId.description": "Memory bank identifier (default: project name)",
  "settings.field.hindsight.scoping.label": "Hindsight Scoping",
  "settings.field.hindsight.scoping.description":
    "global = one shared bank; per-project = isolated bank per cwd; per-project-tagged = shared bank with project tags so global + project memories merge on recall",
  "settings.field.hindsight.autoRecall.label": "Hindsight Auto Recall",
  "settings.field.hindsight.autoRecall.description": "Recall memories on the first turn of each session",
  "settings.field.hindsight.autoRetain.label": "Hindsight Auto Retain",
  "settings.field.hindsight.autoRetain.description": "Retain transcript every N turns and at session boundaries",
  "settings.field.hindsight.retainMode.label": "Hindsight Retain Mode",
  "settings.field.hindsight.retainMode.description":
    "full-session = upsert one document per session, last-turn = chunked",
  "settings.field.hindsight.mentalModelsEnabled.label": "Hindsight Mental Models",
  "settings.field.hindsight.mentalModelsEnabled.description":
    "Read curated reflect summaries (mental models) into developer instructions at boot. Loads existing models on the bank — does not write. Pair with hindsight.mentalModelAutoSeed to also auto-create the built-in seed set.",
  "settings.field.hindsight.mentalModelAutoSeed.label": "Hindsight Mental Model Auto-Seed",
  "settings.field.hindsight.mentalModelAutoSeed.description":
    "At session start, create any built-in mental models (project-conventions, project-decisions, user-preferences) that do not yet exist on the bank.",
};
