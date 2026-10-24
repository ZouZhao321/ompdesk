import { NextResponse } from "next/server";
import { withRequestLog } from "@/lib/api-request-log";
import { auditFailure, auditSuccess } from "@/lib/audit-log";
import { invalidateModelsCache } from "@/lib/models-cache";
import { getOmpRuntime, invalidateOmpRuntime } from "@/lib/omp-runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

// GET /api/auth/api-key/[provider] — returns auth status (never returns the actual key)
export const GET = withRequestLog("/api/auth/api-key/[provider]", getRouteHandler);

async function getRouteHandler(_req: Request, { params }: Params) {
  const { provider } = await params;
  const { modelRegistry, authStorage } = await getOmpRuntime();
  const origin = authStorage.keys.source(provider);
  const models = modelRegistry.getAll().filter((model) => model.provider === provider).length;
  return NextResponse.json({
    provider,
    displayName: provider,
    configured: authStorage.keys.source(provider) !== undefined,
    source: origin?.kind,
    models,
  });
}

// POST /api/auth/api-key/[provider]  body: { apiKey: string }
export const POST = withRequestLog("/api/auth/api-key/[provider]", async (req: Request, { params }: Params) => {
  const { provider } = await params;
  try {
    const { apiKey } = await req.json() as { apiKey?: string };
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      auditFailure("auth.api-key.set", provider, { status: 400, reason: "apiKey-required" });
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }
    const { modelRegistry, authStorage } = await getOmpRuntime();
    if (!modelRegistry.hasProvider(provider)) {
      auditFailure("auth.api-key.set", provider, { status: 400, reason: "unknown-provider" });
      return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
    }
    // omp stores one row per credential in `agent.db`; writing through
    // AuthStorage keeps the CLI and ompdesk on the same store and lock.
    await authStorage.credentials.set(provider, { type: "api_key", key: apiKey.trim(), source: "login" });
    invalidateModelsCache();
    auditSuccess("auth.api-key.set", provider);
    return NextResponse.json({ success: true });
  } catch (error) {
    auditFailure("auth.api-key.set", provider, { status: 500, error });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
});

// DELETE /api/auth/api-key/[provider] — removes stored API keys
export const DELETE = withRequestLog("/api/auth/api-key/[provider]", async (_req: Request, { params }: Params) => {
  const { provider } = await params;
  try {
    const { authStorage } = await getOmpRuntime();
    const stored = authStorage.credentials.list(provider);
    if (stored.some((entry) => entry.credential.type === "oauth")) {
      auditFailure("auth.api-key.remove", provider, { status: 409, reason: "oauth-credential" });
      return NextResponse.json(
        { error: `${provider} is authenticated with OAuth, not an API key` },
        { status: 409 },
      );
    }
    await authStorage.credentials.remove(provider);
    invalidateModelsCache();
    invalidateOmpRuntime();
    auditSuccess("auth.api-key.remove", provider);
    return NextResponse.json({ success: true });
  } catch (error) {
    auditFailure("auth.api-key.remove", provider, { status: 500, error });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
});
