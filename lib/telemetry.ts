import type { AgentTelemetryConfig } from "@oh-my-pi/pi-agent-core";
import { getModelPricingStatus } from "@oh-my-pi/pi-catalog/models";
import type { ModelRegistry, Settings } from "@oh-my-pi/pi-coding-agent";
import {
  createTelemetryExportConfig,
  flushTelemetryExport,
  initTelemetryExport,
  isTelemetryExportEnabled,
} from "@oh-my-pi/pi-coding-agent/telemetry-export";
import { cfgTelemetryOtlpExportEnabled } from "@oh-my-pi/pi-coding-agent/telemetry-settings";

/**
 * OTLP export for ompdesk sessions.
 *
 * The `omp` CLI does this in `src/main.ts`: register the OTLP providers once,
 * then pass `createTelemetryExportConfig()` into the session options. ompdesk
 * builds its own session options, so both steps happen here instead.
 *
 * Registration is process-wide and irreversible: the first call installs
 * global trace/log/meter providers, every later call is a no-op. The
 * `telemetry.otlpExportEnabled` switch therefore comes from the process-wide
 * Settings instance, not from a project-scoped clone, and a change only takes
 * effect on the next launch.
 */
declare global {
  var __ompTelemetryStarted: Promise<boolean> | undefined;
}

function startTelemetryExport(settings: Settings): Promise<boolean> {
  // Telemetry is optional observability: an init failure must not fail session
  // creation. omp caches its own rejected init promise, so a retry would replay
  // the same error — record the outcome once and keep sessions running without
  // export until the process restarts.
  globalThis.__ompTelemetryStarted ??= (async () => {
    await initTelemetryExport(cfgTelemetryOtlpExportEnabled.get(settings));
    return isTelemetryExportEnabled();
  })().catch((error: unknown) => {
    console.error(
      "[ompdesk] telemetry export init failed:",
      error instanceof Error ? error.message : error,
    );
    return false;
  });
  return globalThis.__ompTelemetryStarted;
}

/**
 * Telemetry config for one session, or `undefined` when no `OTEL_*` endpoint is
 * configured — omp then never loads its exporter module at all.
 */
export async function sessionTelemetry(
  settings: Settings,
  modelRegistry: ModelRegistry,
): Promise<AgentTelemetryConfig | undefined> {
  if (!(await startTelemetryExport(settings))) return undefined;
  // Same rule as the CLI: report the provider-computed cost only for models
  // whose rate card is known, instead of exporting a bogus $0.
  return createTelemetryExportConfig(undefined, (providerId, modelId) => {
    const model = modelRegistry.find(providerId, modelId);
    return model !== undefined && getModelPricingStatus(model) !== "unknown";
  });
}

/**
 * Push buffered spans at the end of a turn. omp batches on a 30-second timer,
 * which would leave a fresh trace invisible for that long in the browser.
 * Never rejects; callers that need the flush to finish (shutdown) await it and
 * pass `timeoutMs` so an unreachable collector cannot hold the caller open for
 * the exporter's own timeout.
 */
export async function flushSessionTelemetry(timeoutMs?: number): Promise<void> {
  try {
    const flushing = flushTelemetryExport();
    await (timeoutMs === undefined ? flushing : withTimeout(flushing, timeoutMs));
  } catch (error) {
    console.error("[ompdesk] telemetry flush failed:", error instanceof Error ? error.message : error);
  }
}

function withTimeout(work: Promise<void>, timeoutMs: number): Promise<void> {
  const expired = Promise.withResolvers<void>();
  const timer = setTimeout(expired.resolve, timeoutMs);
  timer.unref?.();
  return Promise.race([work, expired.promise]).finally(() => clearTimeout(timer));
}
