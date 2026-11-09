import { NextResponse } from "next/server";
import { getAgentDir } from "@oh-my-pi/pi-coding-agent";
import { withRequestLog } from "@/lib/api-request-log";
import { readCommentDictionary, type CommentDictionary } from "@/lib/comment-dictionary";
import { isApiRequestAllowed } from "@/lib/request-security";

// POST /api/comment-dictionary/lookup
// Body: { keys: string[] }
// Returns the saved translation text for exactly those keys, so the file
// viewer can render comment translations without pulling the whole machine
// dictionary into the browser. Keys come from the same extraction the panel
// uses, so an entry that is not in the dictionary simply has no text.
const MAX_KEYS = 5000;

export const POST = withRequestLog("/api/comment-dictionary/lookup", lookupHandler);

async function lookupHandler(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || !("keys" in body) || !Array.isArray(body.keys)) {
    return NextResponse.json({ error: "keys must be an array" }, { status: 400 });
  }
  if (body.keys.length > MAX_KEYS) {
    return NextResponse.json({ error: `At most ${MAX_KEYS} keys per request` }, { status: 400 });
  }

  const keys: string[] = [];
  for (const key of body.keys) {
    if (typeof key !== "string") {
      return NextResponse.json({ error: "keys must be strings" }, { status: 400 });
    }
    keys.push(key);
  }

  let dictionary: CommentDictionary;
  try {
    dictionary = readCommentDictionary(getAgentDir());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }

  const translations: Record<string, string> = {};
  for (const key of keys) {
    const record = dictionary.translations[key];
    if (record) translations[key] = record.translation;
  }
  return NextResponse.json({ translations });
}
