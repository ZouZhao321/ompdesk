/** omp 设置面板 model 与 providers 标签的英文文案。 */
export const modelProviders: Record<string, string> = {
	"settings.group.model.thinking": "Thinking",
	"settings.group.model.sampling": "Sampling",
	"settings.group.model.prompt": "Prompt",
	"settings.group.model.retry-fallback": "Retry & Fallback",
	"settings.group.model.advisor": "Advisor",
	"settings.group.model.prewalk": "Prewalk",
	"settings.group.model.vision": "Vision",

	"settings.field.defaultThinkingLevel.label": "Thinking Level",
	"settings.field.defaultThinkingLevel.description": "Reasoning depth for thinking-capable models",
	"settings.field.hideThinkingBlock.label": "Hide Thinking Blocks",
	"settings.field.hideThinkingBlock.description": "Hide thinking blocks in assistant responses",
	"settings.field.expandThinkingBlocks.label": "Expand Thinking Blocks",
	"settings.field.expandThinkingBlocks.description":
		"Keep finished thinking blocks expanded instead of collapsing them when the turn ends",
	"settings.field.proseOnlyThinking.label": "Prose Only Thinking",
	"settings.field.proseOnlyThinking.description":
		"Omit code blocks from thinking summaries and replace them with an ellipsis",
	"settings.field.omitThinking.label": "Omit Thinking summaries",
	"settings.field.omitThinking.description":
		"Instruct upstream providers to completely omit thinking summaries from responses (where supported)",
	"settings.field.externalThinking.label": "External Thinking",
	"settings.field.externalThinking.description":
		"Private scratchpad; not shown to user. Disables supported GPT, Claude, and Gemini reasoning",
	"settings.field.model.loopGuard.enabled.label": "Loop Guard",
	"settings.field.model.loopGuard.enabled.description":
		"Enable automatic stream loop detection for model reasoning and prose",
	"settings.field.model.loopGuard.checkAssistantContent.label": "Loop Guard Scan Prose",
	"settings.field.model.loopGuard.checkAssistantContent.description":
		"Apply loop guard to assistant prose messages in addition to thinking logs",
	"settings.field.model.loopGuard.toolCallReminder.label": "Loop Guard Tool-Call Reminder",
	"settings.field.model.loopGuard.toolCallReminder.description":
		"When a Gemini reasoning stream emits many consecutive planning headers without calling a tool, interrupt it and inject a reminder to issue a tool call (requires Loop Guard)",
	"settings.field.model.toolCallLoopGuard.enabled.label": "Tool-Call Loop Guard",
	"settings.field.model.toolCallLoopGuard.enabled.description":
		"Detect consecutive identical tool calls across turns and inject a corrective steer",
	"settings.field.providers.autoThinkingMaxEffort.label": "Auto Thinking Ceiling",
	"settings.field.providers.autoThinkingMaxEffort.description":
		"Highest effort the `auto` classifier may resolve. `xhigh` keeps the classifier one tier below the top, so only an explicit `ultrathink` reaches `max`; `max` lets a turn the classifier judges exceptional bill the top tier on models that expose it.",

	"settings.field.temperature.label": "Temperature",
	"settings.field.temperature.description":
		"Sampling temperature (0 = deterministic, 1 = creative, -1 = provider default)",
	"settings.field.topP.label": "Top P",
	"settings.field.topP.description": "Nucleus sampling cutoff (0-1, -1 = provider default)",
	"settings.field.topK.label": "Top K",
	"settings.field.topK.description": "Sample from top-K tokens (-1 = provider default)",
	"settings.field.minP.label": "Min P",
	"settings.field.minP.description": "Minimum probability threshold (0-1, -1 = provider default)",
	"settings.field.presencePenalty.label": "Presence Penalty",
	"settings.field.presencePenalty.description":
		"Penalty for introducing already-present tokens (-1 = provider default)",
	"settings.field.repetitionPenalty.label": "Repetition Penalty",
	"settings.field.repetitionPenalty.description": "Penalty for repeated tokens (-1 = provider default)",
	"settings.field.textVerbosity.label": "Text Verbosity",
	"settings.field.textVerbosity.description": "OpenAI Responses and Codex response verbosity (low, medium, or high)",
	"settings.field.tier.openai.label": "Service Tier — OpenAI",
	"settings.field.tier.openai.description":
		"Processing tier for OpenAI / OpenAI-Codex requests, and OpenAI-family models routed via OpenRouter (none = omit). Sent as `service_tier`.",
	"settings.field.tier.anthropic.label": "Service Tier — Anthropic",
	"settings.field.tier.anthropic.description":
		'Processing tier for Claude requests. `priority` realizes fast mode (`speed: "fast"`) on supported direct Anthropic models; ignored on Bedrock/Vertex Claude and via OpenRouter.',
	"settings.field.tier.google.label": "Service Tier — Google",
	"settings.field.tier.google.description":
		"Processing tier for Gemini (Google AI Studio + Vertex) requests, and Google-family models routed via OpenRouter (none = omit). Sent as the top-level `serviceTier` field.",
	"settings.field.tier.subagent.label": "Service Tier — Subagent",
	"settings.field.tier.subagent.description":
		"Service Tier for spawned task/eval subagents. Inherit = match the main agent's live per-family tiers (tracks /fast); pick a value to apply it to whichever family the subagent's model belongs to.",
	"settings.field.tier.advisor.label": "Service Tier — Advisor",
	"settings.field.tier.advisor.description":
		"Service Tier for the advisor model. None = standard processing; Inherit = match the main agent's live per-family tiers; pick a value to apply it to the advisor model's family.",

	"settings.field.modelRoleStorage.label": "Model Role Storage",
	"settings.field.modelRoleStorage.description": "Where model selector role assignments are saved",
	"settings.field.inlineToolDescriptors.label": "Inline Tool Descriptors",
	"settings.field.inlineToolDescriptors.description":
		"Render full tool descriptors in the system prompt and strip top-level/nested descriptions from provider tool schemas so descriptor text is sent once. Auto enables this for Gemini models and disables it otherwise",
	"settings.field.includeModelInPrompt.label": "Include Model in Prompt",
	"settings.field.includeModelInPrompt.description":
		"Surface the active model identifier in the system prompt so the agent knows which model it is",
	"settings.field.includeWorkspaceTree.label": "Include Workspace Tree",
	"settings.field.includeWorkspaceTree.description":
		"Render the workspace directory tree in the system prompt. WARNING: This can bust prompt caching across sessions when files are modified.",
	"settings.field.skillful.label": "List Skills in Prompt",
	"settings.field.skillful.description":
		"List available skills in the system prompt; disable to save context and toggle per-session with /skillful",
	"settings.field.personality.label": "Personality",
	"settings.field.personality.description": "Communication style rendered into the system prompt's personality block",

	"settings.field.retry.maxRetries.label": "Retry Attempts",
	"settings.field.retry.maxRetries.description": "Maximum retry attempts on API errors",
	"settings.field.retry.waitForUsageReset.label": "Wait For Usage Reset",
	"settings.field.retry.waitForUsageReset.description":
		"When a provider reports usage-limit exhaustion with a reset time (5-hour or weekly quota windows on any provider), sleep until the reset instead of failing fast past retry.maxDelayMs. Waits are abortable (Esc) but also hold subagents, so leave off for unattended runs.",
	"settings.field.retry.modelFallback.label": "Retry Model Fallback",
	"settings.field.retry.modelFallback.description": "Allow retry recovery to switch to configured fallback models",
	"settings.field.retry.fallbackOn.label": "Fallback Trigger",
	"settings.field.retry.fallbackOn.description": "Which failed requests may switch to a configured fallback model",
	"settings.field.retry.usageAwareFallback.label": "Usage-Aware Fallback",
	"settings.field.retry.usageAwareFallback.description":
		"Use reliable coding-plan quota reports to prefer same-provider accounts, then configured fallback models, before a hard usage limit. Ordinary configured API keys are excluded.",
	"settings.field.retry.usageReservePct.label": "Reserve Margin",
	"settings.field.retry.usageReservePct.description":
		"Treat a coding-plan model as near its limit below this remaining percentage. Unknown or unmapped usage keeps the primary model.",
	"settings.field.retry.usageReservePolicy.label": "Reserve Policy",
	"settings.field.retry.usageReservePolicy.description":
		"What to do when every same-provider coding-plan account is inside the reserve margin.",
	"settings.field.retry.fallbackChains.label": "Retry Fallback Chains",
	"settings.field.retry.fallbackChains.description":
		'JSON object mapping model roles, model selectors ("provider/model-id"), or provider wildcards ("provider/*") to ordered fallback selectors, e.g. {"default":["openai/gpt-4o-mini"],"google-antigravity/*":["google/*","google-vertex/*"]}. Model-oriented keys apply whenever that model/provider is active, regardless of role; a "provider/*" entry keeps the failing model\'s id and swaps the provider. An id-prefixed wildcard ("openrouter/google/*") re-prefixes the failing model\'s bare id (google-antigravity/gemini-x -> openrouter/google/gemini-x) and, used as a key, matches only that provider\'s ids under the prefix. A fallback entry may carry an explicit thinking suffix ("provider/model:low", ":high", ":max", ":off"); a bare entry inherits the failing turn\'s effort, and "provider/*" entries always inherit.',
	"settings.field.retry.fallbackRevertPolicy.label": "Fallback Revert Policy",
	"settings.field.retry.fallbackRevertPolicy.description": "When to return to the primary model after a fallback",
	"settings.field.providers.anthropic.serverSideFallback.label": "Anthropic Server-Side Fallback (Fable 5)",
	"settings.field.providers.anthropic.serverSideFallback.description":
		"When a Claude Fable 5 / Mythos 5 request is blocked by Anthropic's safety classifier, retry it on Claude Opus 5 server-side (Anthropic `server-side-fallback-2026-06-01` beta). Opt-in — leaving this off preserves the pre-fallback behavior for every request.",

	"settings.field.advisor.enabled.label": "Enable Advisor",
	"settings.field.advisor.enabled.description":
		"Pair a second model (assigned to the 'advisor' role) that passively reviews each turn and injects notes.",
	"settings.field.advisor.syncBacklog.label": "Advisor Sync Backlog",
	"settings.field.advisor.syncBacklog.description":
		"Pause main agent until advisor backlog falls below threshold. Numeric values cap wait at 30 seconds; strict waits for all scheduled reviews without a wall-clock cap. Off disables catch-up delays. Abort, failure, and disposal release waits.",
	"settings.field.advisor.immuneTurns.label": "Advisor Immune Turns",
	"settings.field.advisor.immuneTurns.description":
		"After an advisor concern or blocker interrupts, route further concerns as non-interrupting asides for this many primary turns. Blockers are exempt from the cooldown.",
	"settings.field.advisor.reviewMode.label": "Advisor Review Mode",
	"settings.field.advisor.reviewMode.description":
		"Default advisor cadence when no WATCHDOG.yml roster is present. turn reviews every primary turn; agent-end reviews only final yields.",
	"settings.field.advisor.reviewInterval.label": "Advisor Review Interval",
	"settings.field.advisor.reviewInterval.description":
		"Default advisor cadence when no WATCHDOG.yml roster is present: review every Nth eligible primary update. 1 = every update. Skipped updates are sent with the next scheduled review.",
	"settings.field.advisor.maxNotesPerUpdate.label": "Advisor Max Notes Per Update",
	"settings.field.advisor.maxNotesPerUpdate.description":
		"Maximum non-blocker advice notes accepted per advisor prompt update (1–32; UI offers 1–5 quick picks). Blockers are exempt.",
	"settings.field.advisor.evictStaleResults.label": "Advisor Evict Stale Results",
	"settings.field.advisor.evictStaleResults.description":
		"Before each review, replace the advisor's read/grep/glob output from older reviews with a short placeholder. The latest review is kept.",

	"settings.field.prewalk.enabled.label": "Enable Prewalk",
	"settings.field.prewalk.enabled.description":
		"Start on the active model, then switch to a fast/cheap model (default the 'smol' role) at the first edit/write after the plan nudge's todo list exists — the strong model plans, commits the todos, and starts the implementation before handing off. Overridable per session with --prewalk / --no-prewalk.",

	"settings.field.images.describeForTextModels.label": "Describe Images for Text Models",
	"settings.field.images.describeForTextModels.description":
		"When an image is attached to a model without vision support, save it under local:// and inject a description from a vision-capable model instead of dropping it",
	"settings.field.images.urls.enabled.label": "Serve Images as URLs",
	"settings.field.images.urls.enabled.description":
		"Publish outgoing images through the configured backend chain and send URL-fetching providers short URLs instead of inline base64. Falls back to inline automatically when every backend or a provider fetch fails",
	"settings.field.images.urls.backends.label": "Image URL Backends",
	"settings.field.images.urls.backends.description":
		"Ordered destinations tried when publishing images for provider access",
	"settings.field.images.urls.command.label": "Image Upload Command",
	"settings.field.images.urls.command.description":
		"Argv template for the command backend; {file} is the image path, {mime}/{ext} optional. The last URL printed on stdout is used (e.g. pasta -b -f {file})",
	"settings.field.images.urls.publicBaseUrl.label": "Image URL Public Base",
	"settings.field.images.urls.publicBaseUrl.description":
		"Externally reachable base URL fronting the blob server (required for ssh, optional for direct)",
	"settings.field.images.urls.bindHost.label": "Image URL Bind Host",
	"settings.field.images.urls.bindHost.description":
		"Host the blob server binds to; loopback for tunnels, 0.0.0.0 for direct serving",
	"settings.field.images.urls.sshTarget.label": "Image URL SSH Target",
	"settings.field.images.urls.sshTarget.description": "user@host destination for the ssh reverse forward",

	"settings.group.providers.services": "Services",
	"settings.group.providers.fireworks": "Fireworks",
	"settings.group.providers.tiny-model": "Tiny Model",
	"settings.group.providers.protocol": "Protocol",
	"settings.group.providers.timeouts": "Timeouts",
	"settings.group.providers.privacy": "Privacy",

	"settings.field.providers.maxInFlightRequests.label": "Max In-Flight Requests",
	"settings.field.providers.maxInFlightRequests.description":
		'Maximum concurrent LLM requests per provider id (for example "openai" or "anthropic"), shared across local OMP processes with this config root. Omitted providers are unlimited.',
	"settings.field.providers.webSearchTimeoutSeconds.label": "Web Search Timeout",
	"settings.field.providers.webSearchTimeoutSeconds.description":
		"Hard timeout for each provider's search transport before web_search advances to the next fallback, in seconds (maximum 300)",
	"settings.field.providers.antigravityEndpoint.label": "Antigravity Endpoint Mode",
	"settings.field.providers.antigravityEndpoint.description":
		"Endpoint routing strategy for google-antigravity providers (chat, search, image, discovery)",
	"settings.field.live.voice.label": "Live Voice",
	"settings.field.live.voice.description": "Voice used by Codex-backed realtime voice sessions",
	"settings.field.tts.localVoice.label": "Local TTS Voice",
	"settings.field.tts.localVoice.description":
		"Kokoro voice used by the local TTS backend (American/British, female/male)",
	"settings.field.tts.localSpeed.label": "Local TTS Speed",
	"settings.field.tts.localSpeed.description":
		"Speaking rate of the local TTS backend (tts tool, omp say). 1 = normal; clamped to 0.5–2.5",
	"settings.field.speech.enabled.label": "Speech Vocalization",
	"settings.field.speech.enabled.description": "Speak the assistant's output aloud through the speakers as it streams",
	"settings.field.speech.mode.label": "Speech Vocalization Mode",
	"settings.field.speech.mode.description":
		"What to speak: all = assistant messages + thinking; assistant = messages only; yield = only the final message at turn end",
	"settings.field.speech.enhanced.label": "Enhanced Speech Rewriting",
	"settings.field.speech.enhanced.description":
		"Rewrite assistant output into natural spoken prose with the tiny/smol model before synthesis (describes code, drops links and markdown). Falls back to mechanical cleanup on failure",
	"settings.field.speech.voice.label": "Speech Vocalization Voice",
	"settings.field.speech.voice.description": "Kokoro voice used when speaking the assistant's output aloud",
	"settings.field.speech.speed.label": "Speech Vocalization Speed",
	"settings.field.speech.speed.description":
		"Speaking rate when reading the assistant's output aloud. 1 = normal; clamped to 0.5–2.5",
	"settings.field.providers.fetch.label": "Fetch Provider",
	"settings.field.providers.fetch.description": "Reader backend priority for the fetch/read URL tool",
	"settings.field.codexResets.autoRedeem.label": "Codex Auto-Redeem Saved Resets",
	"settings.field.codexResets.autoRedeem.description":
		"Spend saved Codex rate-limit resets automatically: restore an account blocked by an exhausted 5h or weekly window when a turn is stuck and no other account can take over, and salvage credits that are about to expire. unset asks before the first spend (with no prompt UI, it spends only a reset expiring within 5 minutes), yes spends without prompting, and no disables both checks.",
	"settings.field.claudeResets.autoRedeem.label": "Claude Auto-Redeem Resets",
	"settings.field.claudeResets.autoRedeem.description":
		"Spend eligible Claude Cedar or Juniper resets automatically. Cedar is spent only for covered limits; Juniper can only recover a sole 5-hour block. unset asks before the first spend (with no prompt UI, it spends only a reset expiring within 5 minutes), yes spends without prompting, and no disables blocked recovery and expiry salvage.",
	"settings.field.exa.enabled.label": "Exa",
	"settings.field.exa.enabled.description": "Enable the Exa web search provider",
	"settings.field.searxng.endpoint.label": "SearXNG Endpoint",
	"settings.field.searxng.endpoint.description": "Base URL of a self-hosted SearXNG instance used for web search",

	"settings.field.providers.fireworksTier.label": "Fireworks Tier",
	"settings.field.providers.fireworksTier.description":
		'Serving path for Fireworks requests. Priority sends `service_tier: "priority"` for higher reliability during peak traffic at a higher price; Standard omits it. Fast (`-fast`) models ignore this — Fast is its own serving path.',

	"settings.field.providers.tinyModelDevice.label": "Tiny Model Device",
	"settings.field.providers.tinyModelDevice.description":
		"Inference backend for local tiny models (titles + memory): an ONNX execution provider, or `mlx` to download MLX weights and run them through mlx-lm on Apple silicon. Default uses CPU-only ONNX. The PI_TINY_DEVICE env var overrides this.",
	"settings.field.providers.tinyModelDtype.label": "Tiny Model Precision",
	"settings.field.providers.tinyModelDtype.description":
		"ONNX quantization/precision for local tiny models. Default uses each model's shipped dtype (q4); lower precision is faster, higher is more faithful. Ignored by the MLX backend (its repos are pre-quantized 4-bit). The PI_TINY_DTYPE env var overrides this.",

	"settings.field.providers.kimiApiFormat.label": "Kimi API Format",
	"settings.field.providers.kimiApiFormat.description":
		"API format for Kimi Code provider (auto follows live model metadata)",
	"settings.field.providers.openaiWebsockets.label": "OpenAI WebSockets",
	"settings.field.providers.openaiWebsockets.description":
		"Websocket policy for OpenAI Codex models (auto uses model defaults, on forces, off disables)",
	"settings.field.providers.openaiLiveSteering.label": "OpenAI Live Steering",
	"settings.field.providers.openaiLiveSteering.description":
		"Deliver messages typed while a GPT-6 response streams into that response over the Codex WebSocket, instead of waiting for the next tool boundary",
	"settings.field.providers.muse-code.storeResponses.label": "Muse Code Stored Responses",
	"settings.field.providers.muse-code.storeResponses.description":
		"Store Muse Code results on Meta's servers so a turn whose connection drops is recovered instead of re-run. Stored runs keep prompts and outputs on Meta's side.",
	"settings.field.providers.cacheRetention.label": "Prompt Cache Retention",
	"settings.field.providers.cacheRetention.description":
		"Prompt-cache retention forwarded to providers that support it (Anthropic, Bedrock, OpenRouter, OpenAI)",
	"settings.field.providers.cacheWarming.label": "Cache Warming",
	"settings.field.providers.cacheWarming.description":
		"Re-send the last request with a one-token output budget shortly before its prompt-cache entry expires",
	"settings.field.providers.openrouterVariant.label": "OpenRouter Routing",
	"settings.field.providers.openrouterVariant.description":
		"Default routing-variant suffix appended to OpenRouter model IDs (overridden when the selector already names a variant)",
	"settings.field.provider.appendOnlyContext.label": "Append-Only Context",
	"settings.field.provider.appendOnlyContext.description":
		"Cache system prompt + tool specs and keep an append-only message log so provider prefix caches (DeepSeek, Xiaomi/SGLang, Anthropic) hit at maximum rate. Auto enables for known prefix-cache providers.",

	"settings.field.providers.streamFirstEventTimeoutSeconds.label": "Stream First Event Timeout",
	"settings.field.providers.streamFirstEventTimeoutSeconds.description":
		"Seconds to wait for the first model stream event; -1 uses provider/env defaults, 0 disables the watchdog",
	"settings.field.providers.streamIdleTimeoutSeconds.label": "Stream Idle Timeout",
	"settings.field.providers.streamIdleTimeoutSeconds.description":
		"Seconds a model stream may stay silent between events; -1 uses provider/env defaults, 0 disables the watchdog",

	"settings.field.telemetry.otlpExportEnabled.label": "OTLP Telemetry Export",
	"settings.field.telemetry.otlpExportEnabled.description":
		"Allow OMP to export traces, logs, and metrics using OTEL_* endpoints. Changes take effect on the next launch.",
	"settings.field.secrets.enabled.label": "Hide Secrets",
	"settings.field.secrets.enabled.description":
		"Obfuscate configured secrets and redact credential-shaped tokens before sending to AI providers",
};
