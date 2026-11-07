import { getAgentDir } from "@oh-my-pi/pi-coding-agent";
import { withRequestLog } from "@/lib/api-request-log";
import { createCommentTranslationHandler } from "@/lib/comment-translation-route";
import { resolveCommentTranslationModel } from "@/lib/comment-translation-model";

export const dynamic = "force-dynamic";

const handleGenerate = createCommentTranslationHandler({
	resolveModel: resolveCommentTranslationModel,
	agentDir: getAgentDir,
});

// POST /api/comment-translations/generate
// Body: { entries: [{ original, originalLanguage, targetLanguage }] }
// Generates translations for exactly the checked entries, validates them against
// the source fragments, and stores the accepted ones in the local dictionary.
export const POST = withRequestLog("/api/comment-translations/generate", handleGenerate);
