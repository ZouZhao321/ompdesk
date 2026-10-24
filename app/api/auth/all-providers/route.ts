import { withRequestLog } from "@/lib/api-request-log";
import { buildApiKeyProviderList } from "@/lib/provider-listing";
import { collectProviderListingInputs } from "@/lib/provider-listing-runtime";

export const dynamic = "force-dynamic";

// Providers that accept an API key, including dual-auth ones such as anthropic —
// see lib/provider-listing.ts for why membership is capability-based.
export const GET = withRequestLog("/api/auth/all-providers", getRouteHandler);

async function getRouteHandler() {
  const providers = buildApiKeyProviderList(await collectProviderListingInputs());
  return Response.json({ providers });
}
