import { completeSimple, type AssistantMessage } from "@oh-my-pi/pi-ai";
import { getSetting } from "@/lib/omp-settings";
import { getOmpRuntime } from "@/lib/omp-runtime";
import { readDefaultModelRole } from "@/lib/model-roles";
import { resolveVisibleModels, selectInitialModelScope } from "@/lib/model-scope";
import type { CommentTranslationModel } from "@/lib/comment-translation-generation";

/** 与模型配置页的连通性测试使用同一个超时。 */
const GENERATION_TIMEOUT_MS = 20_000;

function assistantText(message: AssistantMessage): string {
	return message.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("");
}

/**
 * 选出这台机器当前可用的模型，并把它包装成生成接口需要的调用器。
 *
 * 与模型配置页的连通性测试共用同一套运行时模型登记：先按 `enabledModels`
 * 收窄可见模型，再遵循 omp 启动规则优先使用 `default` 角色。没有模型、或者
 * 模型拿不到凭据时返回 null，由路由给出明确提示。
 */
export async function resolveCommentTranslationModel(): Promise<CommentTranslationModel | null> {
	const { modelRegistry, settings } = await getOmpRuntime();
	const scope = await resolveVisibleModels(modelRegistry, getSetting<string[]>(settings, "enabledModels"), settings);
	const selection = selectInitialModelScope(scope, {
		defaultModel: readDefaultModelRole(settings),
	});
	const model = selection.model;
	if (!model) return null;

	const resolved = await modelRegistry.getApiKeyAndHeaders(model);
	if (!resolved.ok || !resolved.apiKey) return null;

	return {
		id: `${model.provider}/${model.id}`,
		complete: async (prompt) => {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);
			try {
				const message = await completeSimple(
					model,
					{
						messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
					},
					{
						apiKey: resolved.apiKey,
						...(resolved.headers ? { headers: resolved.headers } : {}),
						maxTokens: 4_096,
						cacheRetention: "none",
						signal: controller.signal,
					},
				);
				if (message.stopReason === "error" || message.stopReason === "aborted") {
					throw new Error(
						message.errorMessage ??
							(controller.signal.aborted ? "Model request timed out" : "Model request failed"),
					);
				}
				return assistantText(message);
			} finally {
				clearTimeout(timeout);
			}
		},
	};
}
