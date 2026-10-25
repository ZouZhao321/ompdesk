import { withRequestLog } from "@/lib/api-request-log";
import { createClientLogHandler } from "@/lib/client-logs";

/**
 * Browser error ingestion for the Logs panel.
 *
 * The proxy's matcher covers `/api/:path*`, so this route sits behind the same
 * host, cross-site, and password checks as every other API. It is deliberately
 * absent from the recovery allow-list.
 */

export const dynamic = "force-dynamic";

const handleClientLog = createClientLogHandler();

export const POST = withRequestLog("/api/client-logs", handleClientLog);
