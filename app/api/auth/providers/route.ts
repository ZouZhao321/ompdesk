import { withRequestLog } from "@/lib/api-request-log";
import { buildOAuthProviderList } from "@/lib/provider-listing";
import { collectProviderListingInputs } from "@/lib/provider-listing-runtime";

export const dynamic = "force-dynamic";

// Providers that declare an OAuth login method, including anthropic
// (Claude Pro/Max) — see lib/provider-listing.ts.
export const GET = withRequestLog("/api/auth/providers", getRouteHandler);

async function getRouteHandler() {
  const providers = buildOAuthProviderList(await collectProviderListingInputs());
  return Response.json({ providers });
}
