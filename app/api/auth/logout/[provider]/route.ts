import { withRequestLog } from "@/lib/api-request-log";
import { auditFailure, auditSuccess } from "@/lib/audit-log";
import { invalidateModelsCache } from "@/lib/models-cache";
import { getOmpRuntime, invalidateOmpRuntime } from "@/lib/omp-runtime";
import { resolveOAuthLoginId } from "@/lib/provider-listing-runtime";

export const dynamic = "force-dynamic";

export const POST = withRequestLog(
  "/api/auth/logout/[provider]",
  async (_req: Request, { params }: { params: Promise<{ provider: string }> }) => {
    const { provider } = await params;
    try {
      if (!resolveOAuthLoginId(provider)) {
        auditFailure("auth.oauth.logout", provider, { status: 400, reason: "unknown-provider" });
        return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
      }

      const { authStorage } = await getOmpRuntime();
      const stored = authStorage.credentials.list(provider);
      if (stored.length > 0 && !stored.some((entry) => entry.credential.type === "oauth")) {
        auditFailure("auth.oauth.logout", provider, { status: 409, reason: "api-key-credential" });
        return Response.json(
          { error: `${provider} is authenticated with an API key, not OAuth` },
          { status: 409 },
        );
      }

      await authStorage.credentials.remove(provider);
      invalidateModelsCache();
      invalidateOmpRuntime();
      auditSuccess("auth.oauth.logout", provider);
      return Response.json({ ok: true });
    } catch (error) {
      auditFailure("auth.oauth.logout", provider, { status: 500, error });
      throw error;
    }
  },
);
