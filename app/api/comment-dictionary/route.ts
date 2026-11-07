import { NextResponse } from "next/server";
import { getAgentDir } from "@oh-my-pi/pi-coding-agent";
import { withRequestLog } from "@/lib/api-request-log";
import { isCommentLanguage } from "@/lib/comment-entries";
import { deleteCommentDictionary, saveCommentTranslation } from "@/lib/comment-dictionary";
import { isApiRequestAllowed } from "@/lib/request-security";

// PUT /api/comment-dictionary
// Saves one hand-written translation. The key is derived from the normalized
// comment text and the target language; the origin is always manual.
//
// DELETE /api/comment-dictionary
// Removes the whole dictionary file. The panel asks for confirmation first.
export const PUT = withRequestLog("/api/comment-dictionary", putHandler);
export const DELETE = withRequestLog("/api/comment-dictionary", deleteHandler);

function badRequest(error: string) {
	return NextResponse.json({ error }, { status: 400 });
}

async function putHandler(req: Request) {
	if (!isApiRequestAllowed(req)) {
		return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
	}

	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return badRequest("Invalid JSON body");
	}
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return badRequest("JSON object body required");
	}
	if (!("original" in body) || typeof body.original !== "string") {
		return badRequest("original must be a string");
	}
	if (!("translation" in body) || typeof body.translation !== "string") {
		return badRequest("translation must be a string");
	}
	if (!("originalLanguage" in body) || !isCommentLanguage(body.originalLanguage)) {
		return badRequest("originalLanguage must be zh or en");
	}
	if (!("targetLanguage" in body) || !isCommentLanguage(body.targetLanguage)) {
		return badRequest("targetLanguage must be zh or en");
	}

	try {
		const record = saveCommentTranslation(getAgentDir(), {
			original: body.original,
			originalLanguage: body.originalLanguage,
			targetLanguage: body.targetLanguage,
			translation: body.translation,
			origin: "manual",
		});
		return NextResponse.json(record);
	} catch (error) {
		return badRequest(error instanceof Error ? error.message : String(error));
	}
}

async function deleteHandler(req: Request) {
	if (!isApiRequestAllowed(req)) {
		return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
	}
	return NextResponse.json({ deleted: deleteCommentDictionary(getAgentDir()) });
}
