import { NextResponse } from "next/server";
import { getAgentDir } from "@oh-my-pi/pi-coding-agent";
import { isCommentLanguage } from "@/lib/comment-entries";
import {
	generateCommentTranslations,
	type CommentTranslationModel,
	type CommentTranslationRequestEntry,
} from "@/lib/comment-translation-generation";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { MAX_COMMENT_TRANSLATION_ENTRIES } from "@/lib/comment-translation-request";

const MAX_ORIGINAL_LENGTH = 4_000;

/** 解析请求体里的勾选条目；任何字段不合法都整批拒绝。 */
function parseRequestEntries(body: unknown): CommentTranslationRequestEntry[] | null {
	if (typeof body !== "object" || body === null || !("entries" in body)) return null;
	const entries = body.entries;
	if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_COMMENT_TRANSLATION_ENTRIES) {
		return null;
	}

	const parsed: CommentTranslationRequestEntry[] = [];
	for (const value of entries) {
		if (typeof value !== "object" || value === null) return null;
		if (!("original" in value) || typeof value.original !== "string") return null;
		const original = value.original.trim();
		if (!original || original.length > MAX_ORIGINAL_LENGTH) return null;
		if (!("originalLanguage" in value) || !isCommentLanguage(value.originalLanguage)) return null;
		if (!("targetLanguage" in value) || !isCommentLanguage(value.targetLanguage)) return null;
		if (value.originalLanguage === value.targetLanguage) return null;
		if ("force" in value && value.force !== undefined && typeof value.force !== "boolean") return null;
		parsed.push({
			original,
			originalLanguage: value.originalLanguage,
			targetLanguage: value.targetLanguage,
			...(value.force === true ? { force: true } : {}),
		});
	}
	return parsed;
}

/**
 * 生成译文的模型接线。返回 null 表示这台机器上没有可用的模型或凭据，
 * 调用方据此给出明确提示，不回退到任何本地翻译。
 */
export type CommentTranslationModelResolver = () => Promise<CommentTranslationModel | null>;

export interface CommentTranslationHandlerDeps {
	resolveModel: CommentTranslationModelResolver;
	agentDir?: () => string;
}

/**
 * 生成接口的处理器。真实路由只注入运行时模型；测试用同一份请求校验、字典与
 * 片段校验，把模型调用换成固定返回。
 */
export function createCommentTranslationHandler(deps: CommentTranslationHandlerDeps) {
	return async (req: Request): Promise<Response> => {
		if (!isApiRequestAllowed(req)) {
			return NextResponse.json({ code: "untrusted_request", error: "Untrusted API request" }, { status: 403 });
		}
		if (!hasJsonContentType(req)) {
			return NextResponse.json(
				{ code: "invalid_content_type", error: "Content-Type must be application/json" },
				{ status: 415 },
			);
		}

		let body: unknown;
		try {
			body = await req.json();
		} catch {
			return NextResponse.json({ code: "invalid_entries", error: "Body must be JSON" }, { status: 400 });
		}
		const entries = parseRequestEntries(body);
		if (!entries) {
			return NextResponse.json(
				{
					code: "invalid_entries",
					error: `entries must list 1 to ${MAX_COMMENT_TRANSLATION_ENTRIES} comment entries`,
				},
				{ status: 400 },
			);
		}

		let model: CommentTranslationModel | null;
		try {
			model = await deps.resolveModel();
		} catch (error) {
			return NextResponse.json(
				{
					code: "model_unavailable",
					error: error instanceof Error ? error.message : String(error),
				},
				{ status: 500 },
			);
		}
		if (!model) {
			return NextResponse.json(
				{ code: "no_model", error: "No model is available for comment translation" },
				{ status: 409 },
			);
		}

		try {
			const generation = await generateCommentTranslations({
				entries,
				model,
				agentDir: (deps.agentDir ?? getAgentDir)(),
			});
			return NextResponse.json({ model: model.id, ...generation });
		} catch (error) {
			return NextResponse.json(
				{
					code: "model_failed",
					error: error instanceof Error ? error.message : String(error),
				},
				{ status: 502 },
			);
		}
	};
}
